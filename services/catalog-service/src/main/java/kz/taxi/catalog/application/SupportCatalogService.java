package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.SupportMerchantResponse;
import kz.taxi.catalog.api.dto.SupportProductResponse;
import kz.taxi.catalog.api.dto.SupportReservationResponse;
import kz.taxi.catalog.api.dto.SupportStockResponse;
import kz.taxi.catalog.api.mapper.SupportMapper;
import kz.taxi.catalog.domain.Availability;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.domain.StockReservation;
import kz.taxi.catalog.domain.SupportAction;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.StockReservationRepository;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.web.PageResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The read side support actually needs: somebody else's shop, catalog and stock.
 *
 * <p>This service exists because the platform's JWT already carries a
 * {@code SUPPORT} role and {@code AuthenticatedUser.canAccess(owner)} already treats
 * it as "may see other people's data", but no endpoint served that use case — a
 * support agent had either admin rights or nothing. These reads are the missing
 * middle: strictly read-only (no cancel, no state change, no merchant write is
 * reachable from here), scoped to merchant data, and <strong>every one of them
 * leaves an audit row</strong>.
 *
 * <p>Two things about these methods are load-bearing and easy to break by accident:
 *
 * <ul>
 *   <li><strong>Not {@code readOnly}.</strong> Every method writes exactly one row
 *       into the audit trail through {@link SupportAuditService} and therefore needs
 *       a read-write transaction. Marking them {@code readOnly} would both fail the
 *       insert on Postgres and break the guarantee that the row commits with the
 *       read.</li>
 *   <li><strong>The audit call comes last.</strong> The resource is loaded and
 *       mapped first, so a lookup that finds nothing (404) never reaches the audit
 *       write: the trail records data that was handed out, not failed probes.</li>
 * </ul>
 *
 * <p>Unlike the public catalog these reads keep drafts and can keep archived offers,
 * because "why can this customer not buy it?" is usually answered by an offer that
 * is invisible to the shopper.
 */
@Service
public class SupportCatalogService {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    /** How many holds are shown next to a stock row; an offer can have thousands. */
    private static final int MAX_HOLDS = 20;

    private final MerchantRepository merchants;
    private final ProductRepository products;
    private final StockRepository stocks;
    private final StockReservationRepository reservations;
    private final SupportAuditService audit;
    private final SupportMetrics metrics;

    public SupportCatalogService(MerchantRepository merchants,
                                 ProductRepository products,
                                 StockRepository stocks,
                                 StockReservationRepository reservations,
                                 SupportAuditService audit,
                                 SupportMetrics metrics) {
        this.merchants = merchants;
        this.products = products;
        this.stocks = stocks;
        this.reservations = reservations;
        this.audit = audit;
        this.metrics = metrics;
    }

    // ------------------------------------------------------------------ merchants

    @Transactional
    public SupportMerchantResponse merchantById(String merchantId, String actorUserId) {
        Merchant merchant = requireMerchant(requireId(merchantId, "merchantId"));
        SupportMerchantResponse response =
                SupportMapper.toSupportMerchant(merchant, products.countByMerchantId(merchant.getId()));
        audited(SupportAction.MERCHANT_READ, merchant.getId(), actorUserId);
        return response;
    }

    /**
     * Resolves a shop from the user id a complaint is about.
     *
     * <p>This is how a support conversation usually starts: the caller is a person
     * (a user id), while everything else in this service is keyed by merchant id.
     */
    @Transactional
    public SupportMerchantResponse merchantByOwnerUserId(String ownerUserId, String actorUserId) {
        String owner = requireId(ownerUserId, "ownerUserId");
        Merchant merchant = merchants.findByOwnerUserId(owner)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "no merchant profile for user {}", owner));
        SupportMerchantResponse response =
                SupportMapper.toSupportMerchant(merchant, products.countByMerchantId(merchant.getId()));
        audited(SupportAction.MERCHANT_BY_OWNER, merchant.getId(), actorUserId);
        return response;
    }

    /**
     * A merchant's catalog, drafts included.
     *
     * <p>Archived offers are kept only when asked for: they are the merchant's own
     * withdrawal, so they matter when the question is "what happened to this offer?"
     * and are noise when it is "what is this merchant selling?".
     */
    @Transactional
    public PageResponse<SupportProductResponse> productsOfMerchant(String merchantId,
                                                                   boolean includeArchived,
                                                                   int page,
                                                                   int size,
                                                                   String actorUserId) {
        Merchant merchant = requireMerchant(requireId(merchantId, "merchantId"));
        Pageable pageable = PageRequest.of(safePage(page), safeSize(size),
                Sort.by(Sort.Order.asc("title"), Sort.Order.asc("id")));

        Page<Product> found = includeArchived
                ? products.findByMerchantId(merchant.getId(), pageable)
                : products.findByMerchantIdAndStatusNot(merchant.getId(), ProductStatus.ARCHIVED, pageable);

        Map<String, Availability> availability = availabilityOf(found.getContent());
        audited(SupportAction.MERCHANT_PRODUCTS, merchant.getId(), actorUserId);
        return PageResponse.of(found.getContent(), found.getNumber(), found.getSize(),
                found.getTotalElements(), product -> SupportMapper.toSupportProduct(product,
                        merchant.publicName(), availability.getOrDefault(product.getId(), Availability.empty())));
    }

    // ------------------------------------------------------------------ products / stock

    /**
     * One offer with its status and availability — the support answer to a refused
     * purchase. Archived offers are returned here (the public card hides them): an
     * agent must be able to say "the merchant withdrew it", not "not found".
     */
    @Transactional
    public SupportProductResponse product(String productId, String actorUserId) {
        Product product = requireProduct(requireId(productId, "productId"));
        Merchant merchant = requireMerchant(product.getMerchantId());
        SupportProductResponse response = SupportMapper.toSupportProduct(product,
                merchant.publicName(), availabilityOf(product.getId()));
        audited(SupportAction.PRODUCT_READ, product.getId(), actorUserId);
        return response;
    }

    /** The stock counters of one offer plus the holds that explain them. */
    @Transactional
    public SupportStockResponse stock(String productId, String actorUserId) {
        Product product = requireProduct(requireId(productId, "productId"));
        Availability availability = availabilityOf(product.getId());
        List<StockReservation> holds = reservations
                .findByProductIdOrderByCreatedAtDesc(product.getId(), PageRequest.of(0, MAX_HOLDS));
        SupportStockResponse response = SupportMapper.toSupportStock(product, availability, holds);
        audited(SupportAction.STOCK_READ, product.getId(), actorUserId);
        return response;
    }

    /**
     * Every hold of one checkout.
     *
     * <p>An order id with no holds at all is a 404 rather than an empty list: the
     * order was never reserved for in this service, and reporting "no reservations"
     * would read like "this order holds nothing", which is a different and stronger
     * claim than "this service has never heard of it".
     */
    @Transactional
    public List<SupportReservationResponse> reservationsOfOrder(String orderId, String actorUserId) {
        String id = requireId(orderId, "orderId");
        List<StockReservation> holds = reservations.findByOrderIdOrderByProductIdAsc(id);
        if (holds.isEmpty()) {
            throw DomainException.of(CatalogErrorCode.RESERVATION_NOT_FOUND,
                    "no stock reservation for order {}", id).withDetail("orderId", id);
        }
        List<SupportReservationResponse> response = holds.stream()
                .map(SupportMapper::toSupportReservation)
                .toList();
        audited(SupportAction.RESERVATIONS_BY_ORDER, id, actorUserId);
        return response;
    }

    // ------------------------------------------------------------------ internals

    /** The single place where "this read happened" is recorded: audit row, then counter. */
    private void audited(SupportAction action, String resourceId, String actorUserId) {
        audit.append(action, resourceId, actorUserId);
        metrics.supportRead(action.resourceType());
    }

    private Merchant requireMerchant(String merchantId) {
        return merchants.findById(merchantId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "merchant {} not found", merchantId).withDetail("merchantId", merchantId));
    }

    private Product requireProduct(String productId) {
        return products.findById(productId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "product {} not found", productId).withDetail("productId", productId));
    }

    /** Availability of a whole page in one query — a lookup per row is an N+1 in a support tool. */
    private Map<String, Availability> availabilityOf(List<Product> page) {
        if (page.isEmpty()) {
            return Map.of();
        }
        List<String> productIds = page.stream().map(Product::getId).toList();
        Map<String, Availability> found = new HashMap<>(productIds.size());
        for (Stock stock : stocks.findAllById(productIds)) {
            found.put(stock.getProductId(), stock.availability());
        }
        return found;
    }

    /** A product always has a stock row; the fallback keeps a hand-fixed database readable. */
    private Availability availabilityOf(String productId) {
        return stocks.findById(productId).map(Stock::availability).orElseGet(Availability::empty);
    }

    private static int safePage(int page) {
        return Math.max(page, 0);
    }

    private static int safeSize(int size) {
        return size <= 0 ? DEFAULT_PAGE_SIZE : Math.min(size, MAX_PAGE_SIZE);
    }

    private static String requireId(String value, String name) {
        if (value == null || value.isBlank()) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED, "{} must not be blank", name)
                    .withDetail(name, value);
        }
        return value.trim();
    }
}
