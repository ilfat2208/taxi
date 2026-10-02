package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.ReservationLineResponse;
import kz.taxi.catalog.api.dto.ReservationResponse;
import kz.taxi.catalog.api.dto.ReserveStockItemRequest;
import kz.taxi.catalog.api.dto.ReserveStockRequest;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ReservationStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.StockReservationRepository;
import kz.taxi.catalog.infrastructure.config.CatalogProperties;
import kz.taxi.catalog.infrastructure.events.StockCommittedEvent;
import kz.taxi.catalog.infrastructure.events.StockEventLine;
import kz.taxi.catalog.infrastructure.events.StockReleasedEvent;
import kz.taxi.catalog.infrastructure.events.StockReservedEvent;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The reservation use cases the order service drives.
 *
 * <p>Inventory is never decremented at checkout. A checkout <em>holds</em> stock
 * ({@code reserved += n}), and the hold ends in one of three ways: paid
 * ({@code commit}: {@code on_hand -= n} and {@code reserved -= n}), abandoned
 * ({@code release}: {@code reserved -= n}), or timed out (the expiry job does the
 * same as a release). The point of the extra state is that an unpaid order cannot
 * take goods out of the warehouse, and an abandoned cart cannot keep them either.
 *
 * <p>Three properties are load-bearing and easy to break by accident:
 * <ul>
 *   <li><strong>Idempotency by order id.</strong> Every state-changing method first
 *       looks up the stored rows for the order. A retried reserve returns the stored
 *       hold without touching stock; a repeated commit or release returns the stored
 *       state instead of applying the movement twice. The {@code UNIQUE (order_id,
 *       product_id)} constraint is the backstop for two simultaneous first calls.</li>
 *   <li><strong>Availability, not on hand.</strong> The check is
 *       {@code on_hand - reserved >= quantity}, so goods already promised to another
 *       checkout are simply not for sale.</li>
 *   <li><strong>Lock order.</strong> Stock rows are always locked through
 *       {@link StockRepository#lockAllByProductIdIn} (ordered by product id), and the
 *       reservation rows of an order before them, also by product id. Two
 *       transactions touching {A, B} therefore queue up instead of deadlocking.</li>
 * </ul>
 */
@Service
@Slf4j
public class StockReservationService {

    private static final String AGGREGATE_TYPE = "StockReservation";
    private static final int MIN_QUANTITY = 1;
    private static final int MAX_QUANTITY = 99;
    private static final int MAX_ORDER_ID_LENGTH = 26;

    private final ProductRepository products;
    private final StockRepository stocks;
    private final StockReservationRepository reservations;
    private final OutboxWriter outbox;
    private final CatalogProperties properties;

    public StockReservationService(ProductRepository products,
                                   StockRepository stocks,
                                   StockReservationRepository reservations,
                                   OutboxWriter outbox,
                                   CatalogProperties properties) {
        this.products = products;
        this.stocks = stocks;
        this.reservations = reservations;
        this.outbox = outbox;
        this.properties = properties;
    }

    // ------------------------------------------------------------------ reserve

    /**
     * Holds stock for a checkout.
     *
     * <p>A repeat with the same {@code orderId} returns the stored reservation
     * unchanged — including one that was already committed or released, because
     * "what is the state of order X" must have a single answer no matter how many
     * times it is asked.
     */
    @Transactional
    public ReservationResponse reserve(ReserveStockRequest request) {
        String orderId = requireOrderId(request.orderId());

        List<StockReservation> existing = reservations.findByOrderIdOrderByProductIdAsc(orderId);
        if (!existing.isEmpty()) {
            log.info("reservation of order {} already exists ({} line(s), status {}), returning stored state",
                    orderId, existing.size(), existing.get(0).getStatus());
            return toResponse(orderId, existing);
        }

        Map<String, Integer> requested = validateItems(request.items());
        List<String> productIds = List.copyOf(requested.keySet());
        Map<String, Product> byProductId = loadProducts(productIds);
        productIds.forEach(productId -> byProductId.get(productId).requireSellable());
        Currency currency = singleCurrency(byProductId, productIds);

        Map<String, Stock> lockedStock = lockStock(productIds);
        Instant expiresAt = Instant.now().plus(properties.reservationTtl());

        List<StockReservation> holds = new ArrayList<>(productIds.size());
        for (Map.Entry<String, Integer> line : requested.entrySet()) {
            Stock stock = lockedStock.get(line.getKey());
            if (stock == null) {
                // A product without a stock row has nothing to sell; the unique key
                // on stock.product_id means this is a hand-repaired database, not
                // normal traffic.
                throw DomainException.of(CatalogErrorCode.INSUFFICIENT_STOCK,
                                "product {} has no stock record, nothing is available", line.getKey())
                        .withDetail("productId", line.getKey())
                        .withDetail("available", 0)
                        .withDetail("requested", line.getValue());
            }
            stock.reserve(line.getValue());
            holds.add(StockReservation.hold(orderId, line.getKey(), line.getValue(), expiresAt));
        }
        reservations.saveAll(holds);

        List<StockEventLine> lines = eventLines(holds, byProductId);
        outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.STOCK_RESERVED, AGGREGATE_TYPE,
                orderId, holds.get(0).getVersion(),
                new StockReservedEvent(orderId, currency.name(), subtotal(lines), expiresAt, lines));

        log.info("reserved {} line(s) of order {} until {} ({} {})",
                holds.size(), orderId, expiresAt, subtotal(lines), currency.name());
        return toResponse(orderId, holds, byProductId);
    }

    // ------------------------------------------------------------------ commit / release

    /** Payment settled: the goods leave the warehouse. */
    @Transactional
    public ReservationResponse commit(String orderId) {
        String id = requireOrderId(orderId);
        List<StockReservation> holds = requireHolds(id);

        if (holds.stream().allMatch(StockReservation::isCommitted)) {
            log.info("reservation of order {} is already committed, returning stored state", id);
            return toResponse(id, holds);
        }
        requireAllActive(id, holds, "commit");

        List<StockReservation> ordered = sortedByProductId(holds);
        Map<String, Product> byProductId = loadProducts(productIds(ordered));
        Map<String, Stock> lockedStock = lockStock(productIds(ordered));
        for (StockReservation hold : ordered) {
            requireStock(lockedStock, hold).commit(hold.getQuantity());
            hold.commit();
        }

        List<StockEventLine> lines = eventLines(ordered, byProductId);
        outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.STOCK_COMMITTED, AGGREGATE_TYPE,
                id, ordered.get(0).getVersion(),
                new StockCommittedEvent(id, currencyOf(byProductId, ordered).name(), subtotal(lines), lines));

        log.info("committed reservation of order {}: {} line(s), {} taken out of stock",
                id, ordered.size(), subtotal(lines));
        return toResponse(id, ordered, byProductId);
    }

    /**
     * Checkout abandoned or payment failed: the goods go back on sale.
     *
     * <p>A hold that the expiry job already returned is answered with its stored
     * state instead of being released a second time — the second release would
     * subtract a quantity that nobody holds, breaking the reserved counter.
     */
    @Transactional
    public ReservationResponse release(String orderId, String reason) {
        String id = requireOrderId(orderId);
        List<StockReservation> holds = requireHolds(id);

        if (holds.stream().allMatch(hold -> hold.isReleased() || hold.isExpired())) {
            log.info("reservation of order {} is already given back ({}), returning stored state",
                    id, holds.get(0).getStatus());
            return toResponse(id, holds);
        }
        requireAllActive(id, holds, "release");

        List<StockReservation> ordered = sortedByProductId(holds);
        Map<String, Product> byProductId = loadProducts(productIds(ordered));
        Map<String, Stock> lockedStock = lockStock(productIds(ordered));
        for (StockReservation hold : ordered) {
            requireStock(lockedStock, hold).release(hold.getQuantity());
            hold.release();
        }

        String releaseReason = normalizeReason(reason);
        List<StockEventLine> lines = eventLines(ordered, byProductId);
        outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.STOCK_RELEASED, AGGREGATE_TYPE,
                id, ordered.get(0).getVersion(),
                new StockReleasedEvent(id, releaseReason, currencyOf(byProductId, ordered).name(),
                        subtotal(lines), lines));

        log.info("released reservation of order {} ({}): {} line(s) back on sale",
                id, releaseReason, ordered.size());
        return toResponse(id, ordered, byProductId);
    }

    /** Reads the stored state; a read takes no locks, only the writers do. */
    @Transactional(readOnly = true)
    public ReservationResponse get(String orderId) {
        String id = requireOrderId(orderId);
        return toResponse(id, findByOrder(id));
    }

    // ------------------------------------------------------------------ expiry

    /**
     * Returns the stock of every hold that outlived {@code taxi.catalog.reservation-ttl}.
     *
     * <p>Deliberately a plain method, not a {@code @Scheduled} one: the scheduler is
     * an infrastructure detail ({@code ReservationExpiryJob}), and this movement has
     * to be callable from a test and from an operator's admin script.
     *
     * @return how many reservation rows were expired
     */
    @Transactional
    public int expireOverdue() {
        Instant now = Instant.now();
        List<StockReservation> overdue = reservations.lockOverdue(ReservationStatus.ACTIVE, now);
        if (overdue.isEmpty()) {
            return 0;
        }

        List<StockReservation> ordered = sortedByProductId(overdue);
        Map<String, Product> byProductId = loadProducts(productIds(ordered));
        Map<String, Stock> lockedStock = lockStock(productIds(ordered));
        for (StockReservation hold : ordered) {
            Stock stock = lockedStock.get(hold.getProductId());
            if (stock != null) {
                stock.release(hold.getQuantity());
            }
            hold.expire();
        }

        // One event per order, not per line: consumers react to "this checkout is
        // dead", and an order's lines are always expired together.
        Map<String, List<StockReservation>> byOrder = ordered.stream()
                .collect(Collectors.groupingBy(StockReservation::getOrderId, LinkedHashMap::new,
                        Collectors.toList()));
        byOrder.forEach((orderId, holds) -> {
            List<StockEventLine> lines = eventLines(holds, byProductId);
            outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.STOCK_RELEASED, AGGREGATE_TYPE,
                    orderId, holds.get(0).getVersion(),
                    new StockReleasedEvent(orderId, StockReleasedEvent.REASON_EXPIRED,
                            currencyOf(byProductId, holds).name(), subtotal(lines), lines));
        });

        log.info("expired {} overdue reservation(s) across {} order(s)", ordered.size(), byOrder.size());
        return ordered.size();
    }

    // ------------------------------------------------------------------ internals

    /** Sorted map by product id: the request order must not decide anything downstream. */
    private static Map<String, Integer> validateItems(List<ReserveStockItemRequest> items) {
        if (items == null || items.isEmpty()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                    "a reservation needs at least one item");
        }
        Map<String, Integer> requested = new TreeMap<>();
        for (ReserveStockItemRequest item : items) {
            if (item == null || item.productId() == null || item.productId().isBlank()) {
                throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                        "every reservation item needs a productId");
            }
            String productId = item.productId().trim();
            Integer quantity = item.quantity();
            if (quantity == null || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
                throw DomainException.of(CatalogErrorCode.INVALID_QUANTITY,
                                "quantity of product {} must be between {} and {} but was {}",
                                productId, MIN_QUANTITY, MAX_QUANTITY, quantity)
                        .withDetail("productId", productId)
                        .withDetail("quantity", quantity);
            }
            if (requested.putIfAbsent(productId, quantity) != null) {
                // Merging silently would hide a client bug and change the amount the
                // buyer was quoted, so the duplicate is rejected outright.
                throw DomainException.of(CatalogErrorCode.INVALID_QUANTITY,
                                "product {} appears twice in one reservation", productId)
                        .withDetail("productId", productId);
            }
        }
        return requested;
    }

    private Map<String, Product> loadProducts(List<String> productIds) {
        Map<String, Product> found = products.findAllById(productIds).stream()
                .collect(Collectors.toMap(Product::getId, Function.identity(), (a, b) -> a,
                        LinkedHashMap::new));
        for (String productId : productIds) {
            if (!found.containsKey(productId)) {
                throw DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "product {} not found", productId).withDetail("productId", productId);
            }
        }
        return found;
    }

    /** One reservation, one currency — otherwise the subtotal would be meaningless. */
    private static Currency singleCurrency(Map<String, Product> byProductId, List<String> productIds) {
        Set<Currency> currencies = new LinkedHashSet<>();
        for (String productId : productIds) {
            currencies.add(byProductId.get(productId).getCurrency());
        }
        if (currencies.size() != 1) {
            throw DomainException.of(CatalogErrorCode.MIXED_CURRENCIES,
                            "a reservation cannot mix currencies but got {}", currencies)
                    .withDetail("currencies", currencies.stream().map(Enum::name).toList());
        }
        return currencies.iterator().next();
    }

    private Map<String, Stock> lockStock(List<String> sortedProductIds) {
        if (sortedProductIds.isEmpty()) {
            return Map.of();
        }
        return stocks.lockAllByProductIdIn(sortedProductIds).stream()
                .collect(Collectors.toMap(Stock::getProductId, Function.identity(), (a, b) -> a,
                        LinkedHashMap::new));
    }

    /** Writers take the row locks: a commit racing an expiry must serialize on them. */
    private List<StockReservation> requireHolds(String orderId) {
        return requireNonEmpty(reservations.lockByOrderId(orderId), orderId);
    }

    private List<StockReservation> findByOrder(String orderId) {
        return requireNonEmpty(reservations.findByOrderIdOrderByProductIdAsc(orderId), orderId);
    }

    private static List<StockReservation> requireNonEmpty(List<StockReservation> holds, String orderId) {
        if (holds.isEmpty()) {
            throw DomainException.of(CatalogErrorCode.RESERVATION_NOT_FOUND,
                    "no stock reservation for order {}", orderId).withDetail("orderId", orderId);
        }
        return holds;
    }

    private static void requireAllActive(String orderId, List<StockReservation> holds, String operation) {
        Set<ReservationStatus> statuses = holds.stream()
                .map(StockReservation::getStatus)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        if (statuses.size() != 1 || !statuses.contains(ReservationStatus.ACTIVE)) {
            throw DomainException.of(CatalogErrorCode.RESERVATION_NOT_ACTIVE,
                            "cannot {} reservation of order {}: its status is {}",
                            operation, orderId, statuses)
                    .withDetail("orderId", orderId)
                    .withDetail("status", statuses.iterator().next().name());
        }
    }

    private static Stock requireStock(Map<String, Stock> lockedStock, StockReservation hold) {
        Stock stock = lockedStock.get(hold.getProductId());
        if (stock == null) {
            throw DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                    "stock record of product {} not found", hold.getProductId());
        }
        return stock;
    }

    private static List<StockReservation> sortedByProductId(List<StockReservation> holds) {
        return holds.stream()
                .sorted(Comparator.comparing(StockReservation::getProductId))
                .toList();
    }

    private static List<String> productIds(List<StockReservation> holds) {
        return holds.stream().map(StockReservation::getProductId).distinct().sorted().toList();
    }

    private static List<StockEventLine> eventLines(List<StockReservation> holds,
                                                   Map<String, Product> byProductId) {
        List<StockEventLine> lines = new ArrayList<>(holds.size());
        for (StockReservation hold : holds) {
            Product product = byProductId.get(hold.getProductId());
            long unitPriceMinor = product.getPriceMinor();
            lines.add(new StockEventLine(product.getId(), product.getMerchantId(), hold.getQuantity(),
                    unitPriceMinor, Math.multiplyExact(unitPriceMinor, hold.getQuantity())));
        }
        return List.copyOf(lines);
    }

    private static long subtotal(List<StockEventLine> lines) {
        long total = 0L;
        for (StockEventLine line : lines) {
            total = Math.addExact(total, line.lineTotalMinor());
        }
        return total;
    }

    private static Currency currencyOf(Map<String, Product> byProductId, List<StockReservation> holds) {
        return byProductId.get(holds.get(0).getProductId()).getCurrency();
    }

    private static String normalizeReason(String reason) {
        return reason == null || reason.isBlank() ? StockReleasedEvent.REASON_UNSPECIFIED : reason.trim();
    }

    private static String requireOrderId(String orderId) {
        if (orderId == null || orderId.isBlank()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED, "orderId must not be blank");
        }
        String trimmed = orderId.trim();
        if (trimmed.length() > MAX_ORDER_ID_LENGTH) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                    "orderId must be at most {} characters but was {}", MAX_ORDER_ID_LENGTH, trimmed.length());
        }
        return trimmed;
    }

    /** Rebuilds the response from the stored rows, so every path answers the same shape. */
    private ReservationResponse toResponse(String orderId, List<StockReservation> holds) {
        List<StockReservation> ordered = sortedByProductId(holds);
        return toResponse(orderId, ordered, loadProducts(productIds(ordered)));
    }

    private static ReservationResponse toResponse(String orderId,
                                                  List<StockReservation> holds,
                                                  Map<String, Product> byProductId) {
        List<ReservationLineResponse> lines = new ArrayList<>(holds.size());
        long subtotalMinor = 0L;
        for (StockReservation hold : holds) {
            Product product = byProductId.get(hold.getProductId());
            long unitPriceMinor = product.getPriceMinor();
            long lineTotalMinor = Math.multiplyExact(unitPriceMinor, hold.getQuantity());
            subtotalMinor = Math.addExact(subtotalMinor, lineTotalMinor);
            lines.add(new ReservationLineResponse(product.getId(), product.getMerchantId(),
                    product.getTitle(), hold.getQuantity(), unitPriceMinor, lineTotalMinor,
                    product.getCurrency().name()));
        }
        StockReservation first = holds.get(0);
        return new ReservationResponse(orderId, first.getStatus(),
                byProductId.get(first.getProductId()).getCurrency().name(),
                subtotalMinor, first.getExpiresAt(), List.copyOf(lines));
    }
}
