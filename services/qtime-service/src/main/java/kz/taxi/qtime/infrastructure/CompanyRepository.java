package kz.taxi.qtime.infrastructure;

import kz.taxi.qtime.domain.Company;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

/**
 * Companies.
 *
 * <p>{@link JpaSpecificationExecutor} carries the public search: name, category and
 * city are all optional, and building the {@code where} clause from the filters that
 * are actually present is more honest than a query with three nullable parameters —
 * the latter works until a database cannot infer the type of a bound {@code null},
 * and then it fails at runtime, in production, on the one request shape nobody tests.
 */
public interface CompanyRepository extends JpaRepository<Company, String>, JpaSpecificationExecutor<Company> {
}
