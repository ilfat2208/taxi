package kz.taxi.catalog.infrastructure.seed;

import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.Stock;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.catalog.infrastructure.ProductRepository;
import kz.taxi.catalog.infrastructure.StockRepository;
import kz.taxi.catalog.infrastructure.events.ProductPublishedEvent;
import kz.taxi.common.core.money.Currency;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Seeds a browsable marketplace on an empty database.
 *
 * <p>A catalog service with no products cannot be demonstrated: search has nothing
 * to rank, the checkout path has nothing to reserve, and every reviewer ends up
 * hand-writing SQL. The seeder is therefore part of the service, not of a
 * migration — but it is deliberately paranoid about it:
 *
 * <ul>
 *   <li>it runs only when the product table is empty, so a restart never
 *       duplicates data and re-seeding a live database is impossible;</li>
 *   <li>it runs after the context is up (Flyway has already migrated);</li>
 *   <li>it can be switched off with {@code taxi.demo.seed=false};</li>
 *   <li>it never fails startup: any failure is logged and the service starts with
 *       an empty catalog, which is a legitimate state (demo data is not a
 *       correctness requirement of the service).</li>
 * </ul>
 *
 * <p>Ownership uses fixed {@code demo-*} user ids, so a locally minted JWT with
 * that subject can act as the seeded merchant without touching the database.
 */
@Component
@Slf4j
public class DemoCatalogSeeder implements ApplicationRunner {

    private static final List<DemoMerchant> DEMO_MERCHANTS = List.of(
            new DemoMerchant("demo-merchant-tech", "TechnoMart", "TechnoMart Store",
                    "+77001234501", "tech@demo.taxi.local", "Алматы"),
            new DemoMerchant("demo-merchant-home", "HomeComfort", "HomeComfort",
                    "+77001234502", "home@demo.taxi.local", "Астана"),
            new DemoMerchant("demo-merchant-fresh", "FreshMarket", "FreshMarket",
                    "+77001234503", "fresh@demo.taxi.local", "Шымкент"));

    private static final List<DemoProduct> DEMO_PRODUCTS = List.of(
            // Электроника
            new DemoProduct("demo-merchant-tech", "TECH-0001", "Смартфон Samsung Galaxy A55 128GB",
                    "6.6\" Super AMOLED, 8 ГБ ОЗУ, 5G, гарантия 1 год", "Электроника", "Samsung",
                    18_999_000L, 24),
            new DemoProduct("demo-merchant-tech", "TECH-0002", "Ноутбук Lenovo IdeaPad 3 15\"",
                    "Ryzen 5, 16 ГБ ОЗУ, SSD 512 ГБ, Windows 11", "Электроника", "Lenovo",
                    27_999_000L, 12),
            new DemoProduct("demo-merchant-tech", "TECH-0003", "Наушники JBL Tune 510BT",
                    "Беспроводные, Bluetooth 5.0, до 40 часов работы", "Электроника", "JBL",
                    2_499_000L, 80),
            new DemoProduct("demo-merchant-tech", "TECH-0004", "Телевизор LG 55UR78006 4K",
                    "55 дюймов, 4K UHD, Smart TV webOS", "Электроника", "LG",
                    49_990_000L, 7),
            // Бытовая техника
            new DemoProduct("demo-merchant-home", "HOME-0001", "Пылесос Dyson V11 Absolute",
                    "Беспроводной, 60 минут работы, HEPA-фильтр", "Бытовая техника", "Dyson",
                    34_999_000L, 9),
            new DemoProduct("demo-merchant-home", "HOME-0002", "Микроволновая печь Samsung ME83KRW-1",
                    "23 л, биокерамическое покрытие, 800 Вт", "Бытовая техника", "Samsung",
                    5_499_000L, 31),
            new DemoProduct("demo-merchant-home", "HOME-0003", "Кофемашина DeLonghi ECAM 22.110",
                    "Автоматическая, 15 бар, встроенная кофемолка", "Бытовая техника", "DeLonghi",
                    38_990_000L, 5),
            // Продукты
            new DemoProduct("demo-merchant-fresh", "FOOD-0001", "Кофе в зёрнах Lavazza Qualita Oro 1 кг",
                    "Средняя обжарка, арабика 100%", "Продукты", "Lavazza",
                    1_249_000L, 60),
            new DemoProduct("demo-merchant-fresh", "FOOD-0002", "Масло оливковое Extra Virgin 500 мл",
                    "Первый холодный отжим, стеклянная бутылка", "Продукты", "Monini",
                    429_000L, 120),
            new DemoProduct("demo-merchant-fresh", "FOOD-0003", "Шоколад молочный Ritter Sport 100 г",
                    "Альпийское молоко, без пальмового масла", "Продукты", "Ritter Sport",
                    129_000L, 200),
            // Красота
            new DemoProduct("demo-merchant-fresh", "BEAUTY-0001", "Крем для лица La Roche-Posay Effaclar Duo+ 40 мл",
                    "Против несовершенств, для комбинированной кожи", "Красота", "La Roche-Posay",
                    989_000L, 45),
            new DemoProduct("demo-merchant-tech", "BEAUTY-0002", "Набор шампунь и бальзам Kerastase 250 мл",
                    "Питание для окрашенных волос", "Красота", "Kerastase",
                    1_450_000L, 18));

    private final MerchantRepository merchants;
    private final ProductRepository products;
    private final StockRepository stocks;
    private final OutboxWriter outbox;
    private final TransactionTemplate transactionTemplate;
    private final boolean enabled;

    public DemoCatalogSeeder(MerchantRepository merchants,
                             ProductRepository products,
                             StockRepository stocks,
                             OutboxWriter outbox,
                             PlatformTransactionManager transactionManager,
                             @Value("${taxi.demo.seed:true}") boolean enabled) {
        this.merchants = merchants;
        this.products = products;
        this.stocks = stocks;
        this.outbox = outbox;
        // An explicit template rather than @Transactional on run(): the runner is
        // invoked by the bootstrapper, and a self-call would silently skip the proxy.
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.enabled = enabled;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!enabled) {
            log.info("demo catalog seeding disabled (taxi.demo.seed=false)");
            return;
        }
        try {
            Integer seeded = transactionTemplate.execute(status -> seedIfEmpty());
            if (seeded == null || seeded == 0) {
                log.info("demo catalog seeding skipped: the catalog already has products");
            } else {
                log.info("seeded demo catalog: {} merchants, {} products", DEMO_MERCHANTS.size(), seeded);
            }
        } catch (RuntimeException failure) {
            // A broken seed must never take the service down: an empty catalog is a
            // valid state, and the operator can re-run the seeding by hand.
            log.warn("demo catalog seeding failed and was rolled back: {}", failure.toString());
        }
    }

    /** Runs inside one transaction: either the whole demo marketplace exists or none of it does. */
    private int seedIfEmpty() {
        long existing = products.count();
        if (existing > 0) {
            log.debug("catalog already contains {} products, nothing to seed", existing);
            return 0;
        }

        Map<String, Merchant> byOwner = new LinkedHashMap<>();
        for (DemoMerchant demo : DEMO_MERCHANTS) {
            Merchant merchant = merchants.save(Merchant.register(demo.ownerUserId(), demo.name(),
                    demo.displayName(), demo.phone(), demo.email(), demo.city()));
            byOwner.put(demo.ownerUserId(), merchant);
        }

        for (DemoProduct demo : DEMO_PRODUCTS) {
            Merchant merchant = byOwner.get(demo.merchantOwnerUserId());
            Product product = products.save(Product.publish(merchant.getId(), demo.sku(), demo.title(),
                    demo.description(), demo.category(), demo.brand(), Currency.KZT,
                    demo.priceMinor(), imageUrl(demo.sku())));
            stocks.save(Stock.withOnHand(product.getId(), demo.initialStock()));
            // Same rule as the merchant-facing use case: publishing a product is an
            // event, and the outbox row commits with the product itself.
            outbox.append(KafkaTopics.CATALOG_EVENTS, KafkaTopics.Events.PRODUCT_PUBLISHED, "Product",
                    product.getId(), product.getVersion(),
                    new ProductPublishedEvent(product.getId(), product.getMerchantId(), product.getTitle(),
                            product.getCategory(), product.getBrand(), product.getPriceMinor(),
                            product.getCurrency().name(), product.getStatus().name()));
        }
        return DEMO_PRODUCTS.size();
    }

    /** Placeholder image host: demo data must not depend on a reachable CDN. */
    private static String imageUrl(String sku) {
        return "https://cdn.taxi.local/demo/" + sku.toLowerCase() + ".jpg";
    }

    private record DemoMerchant(String ownerUserId, String name, String displayName,
                                String phone, String email, String city) {
    }

    private record DemoProduct(String merchantOwnerUserId, String sku, String title, String description,
                               String category, String brand, long priceMinor, int initialStock) {
    }
}
