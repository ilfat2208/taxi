package kz.taxi.catalog.infrastructure;

import kz.taxi.catalog.domain.Product;
import kz.taxi.catalog.domain.ProductStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface ProductRepository extends JpaRepository<Product, String> {

    /** Pre-check for the {@code uq_product_merchant_sku} constraint, to answer 409 instead of 500. */
    boolean existsByMerchantIdAndSku(String merchantId, String sku);

    long countByMerchantId(String merchantId);

    Optional<Product> findByIdAndMerchantId(String id, String merchantId);

    /**
     * A merchant's whole catalog, for support.
     *
     * <p>Unlike the public search this keeps drafts (and, through the variant below,
     * archived offers on request): support answers "why can this customer not buy
     * it", and the answer is very often an offer that never made it out of draft or
     * one the merchant withdrew.
     */
    Page<Product> findByMerchantId(String merchantId, Pageable pageable);

    /** The merchant's catalog without the offers the merchant withdrew. */
    Page<Product> findByMerchantIdAndStatusNot(String merchantId, ProductStatus status, Pageable pageable);

    /** Categories a shopper can actually browse: only offers that are on sale. */
    @Query("""
            select distinct p.category from Product p
            where p.status = :status
            order by p.category asc
            """)
    List<String> findCategoriesByStatus(@Param("status") ProductStatus status);
}
