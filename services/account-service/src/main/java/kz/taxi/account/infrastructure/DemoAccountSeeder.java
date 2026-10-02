package kz.taxi.account.infrastructure;

import kz.taxi.account.domain.Account;
import kz.taxi.account.domain.AccountStatus;
import kz.taxi.account.domain.AccountType;
import kz.taxi.common.core.money.Currency;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Makes a fresh environment usable, and nothing more.
 *
 * <p>A demo needs somewhere for demo money to come from, so the platform suspense
 * account of every currency is created eagerly. It is created idempotently and never
 * overwrites an existing row: a seeder that "fixes" data on every restart is how
 * demo fixtures end up in production.
 *
 * <p>Note that {@link ApplicationRunner#run} itself carries {@code @Transactional}.
 * Calling a transactional method of the same class would silently run without a
 * transaction (self-invocation bypasses the proxy), and the repository's pessimistic
 * lock then fails with "Query requires transaction be in progress" — the kind of bug
 * that only shows up at startup.
 */
@Component
@ConditionalOnProperty(name = "taxi.demo.seed", havingValue = "true", matchIfMissing = true)
@Slf4j
public class DemoAccountSeeder implements ApplicationRunner {

    private final AccountRepository accountRepository;

    public DemoAccountSeeder(AccountRepository accountRepository) {
        this.accountRepository = accountRepository;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        List<String> created = new ArrayList<>();
        for (Currency currency : Currency.values()) {
            Optional<Account> existing = accountRepository.findFirstByTypeAndCurrencyAndStatus(
                    AccountType.SYSTEM, currency, AccountStatus.ACTIVE);
            if (existing.isEmpty()) {
                Account account = accountRepository.save(Account.openSystemAccount(currency));
                created.add(account.getId() + " (" + currency + ")");
            }
        }
        if (created.isEmpty()) {
            log.info("platform suspense accounts already present");
        } else {
            log.info("created platform suspense accounts: {}", created);
        }
    }
}
