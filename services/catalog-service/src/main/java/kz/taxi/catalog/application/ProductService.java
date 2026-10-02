package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.CreateProductRequest;
import kz.taxi.catalog.api.dto.ProductDetailResponse;
import kz.taxi.catalog.api.dto.UpdateProductRequest;
import kz.taxi.catalog.api.mapper.CatalogMapper;
import kz.taxi.catalog.domain.Availability;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.events.ProductPublishedEvent;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Merchant-facing catalog writes.
 *
 * <p>Two rules shape this class:
 * <ol>
 *   <li><strong>Ownership comes from the token.</strong> The merchant is resolved by
 *       {@code owner_user_id} of the caller, never from a path or body parameter,
 *       and a product that belongs to somebody else is rejected with 403 rather
 *       than silently treated as missing.</li>
 *   <li><strong>A product and its stock row are born together.</strong> A product
 *       without inventory cannot be ordered and would make every checkout fail in a
 *       confusing way, so both rows are written in the same transaction.</li>
 * </ol>
 */
@Service
@Slf4j
public class ProductService {

    private static final String AGGREGATE_TYPE = "Product";

    private final ProductRepository products;
    private final StockRepository stocks;
    private final MerchantRepository merchants;
    private final OutboxWriter outbox;

    public ProductService(ProductRepository products,
                          StockRepository stocks,
                          MerchantRepository merchants,
                          OutboxWriter outbox) {
        this.products = products;
        this.stocks = stocks;
        this.merchants = merchants;
        this.outbox = outbox;
    }

    /** Publishes a new offer and creates its stock row. */
    @Transactional
    public ProductDetailResponse createProduct(String ownerUserId, CreateProductRequest request) {
        Merchant merchant = requireMerchantOf(ownerUserId);
        Currency currency = requireCurrency(request.currency());

        if (products.existsByMerchantIdAndSku(merchant.getId(), request.sku())) {
            throw duplicateSku(merchant.getId(), request.sku());
        }

        Product product = Product.publish(merchant.getId(), request.sku(), request.title(),
                request.description(), request.category(), request.brand(), currency,
                request.priceMinor(), request.imageUrl());
        try {
            // Flushed now, not at commit: that turns a lost race on
            // uq_product_merchant_sku into a 409 instead of a 500 at the transaction
            // boundary, where the constraint violation would have no business meaning.
            products.saveAndFlush(product);
        } catch (DataIntegrityViolationException race) {
            throw duplicateSku(merchant.getId(), request.sku());
        }

        int initialStock = request.initialStock() == null ? 0 : request.initialStock();
        Stock stock = stocks.save(Stock.withOnHand(product.getId(), initialStock));

        publishEvent(product);
        log.info("merchant {} published product {} (sku {}) with {} unit(s) on hand",
                merchant.getId(), product.getId(), product.getSku(), initialStock);
        return CatalogMapper.toDetail(product, merchant, stock.availability());
    }

    /**
     * Partial update of an offer, including a stock delta.
     *
     * <p>The stock row is locked before it is adjusted: two devices editing the same
     * product concurrently must serialize, otherwise both would read the same
     * {@code on_hand} and one adjustment would vanish.
     */
    @Transactional
    public ProductDetailResponse updateProduct(String ownerUserId, String productId,
                                               UpdateProductRequest request) {
        Product product = products.findById(productId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "product {} not found", productId));
        Merchant merchant = requireMerchant(product.getMerchantId());
        if (!merchant.getOwnerUserId().equals(ownerUserId)) {
            throw DomainException.of(CatalogErrorCode.NOT_MERCHANT_OWNER,
                            "product {} belongs to another merchant", productId)
                    .withDetail("productId", productId);
        }

        product.updateDetails(request.title(), request.description(), request.category(), request.brand());
        if (request.priceMinor() != null) {
            product.changePrice(request.priceMinor());
        }

        ProductStatus previousStatus = product.getStatus();
        product.changeStatus(request.status());

        Availability availability = adjustStock(product, request);

        // Publishing is the one product fact other services act on, so it is emitted
        // exactly when an offer becomes ACTIVE again (a DRAFT being published).
        if (previousStatus != ProductStatus.ACTIVE && product.getStatus() == ProductStatus.ACTIVE) {
            publishEvent(product);
        }
        return CatalogMapper.toDetail(product, merchant, availability);
    }

    private Availability adjustStock(Product product, UpdateProductRequest request) {
        Integer delta = request.stockDelta();
        if (delta == null || delta == 0) {
            return stocks.findById(product.getId()).map(Stock::availability).orElseGet(Availability::empty);
        }
        Stock stock = stocks.lockByProductId(product.getId())
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.PRODUCT_NOT_FOUND,
                        "stock record of product {} not found", product.getId()));
        stock.adjust(delta);
        log.info("stock of product {} adjusted by {} (reason: {}), on hand is now {} with {} reserved",
                product.getId(), delta, reason(request.stockReason()),
                stock.getOnHand(), stock.getReserved());
        return stock.availability();
    }

    private void publishEvent(Product product) {
        outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.PRODUCT_PUBLISHED, AGGREGATE_TYPE,
                product.getId(), product.getVersion(),
                new ProductPublishedEvent(product.getId(), product.getMerchantId(), product.getTitle(),
                        product.getCategory(), product.getBrand(), product.getPriceMinor(),
                        product.getCurrency().name(), product.getStatus().name()));
    }

    private Merchant requireMerchantOf(String ownerUserId) {
        return merchants.findByOwnerUserId(ownerUserId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "user {} has no merchant profile; register one before publishing products",
                        ownerUserId));
    }

    private Merchant requireMerchant(String merchantId) {
        return merchants.findById(merchantId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "merchant {} not found", merchantId));
    }

    /** An unsupported currency is a client mistake (400), not a broken server. */
    private static Currency requireCurrency(String code) {
        if (!Currency.isSupported(code)) {
            throw DomainException.of(CommonErrorCode.VALIDATION_FAILED,
                    "currency '{}' is not supported, expected one of KZT, USD, EUR, RUB", code);
        }
        return Currency.of(code);
    }

    private static DomainException duplicateSku(String merchantId, String sku) {
        return DomainException.of(CatalogErrorCode.DUPLICATE_SKU,
                        "merchant {} already has a product with sku {}", merchantId, sku)
                .withDetail("merchantId", merchantId)
                .withDetail("sku", sku);
    }

    private static String reason(String stockReason) {
        return stockReason == null || stockReason.isBlank() ? "not specified" : stockReason.trim();
    }
}
