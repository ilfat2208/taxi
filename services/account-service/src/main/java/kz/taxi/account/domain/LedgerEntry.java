package kz.taxi.account.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import kz.taxi.common.core.id.Ulid;
import kz.taxi.common.core.money.Currency;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One side of a money movement. Append-only.
 *
 * <p>Every movement writes exactly two entries — a DEBIT and a CREDIT — sharing
 * a {@code transactionId} and the same positive amount, so that for any
 * transaction {@code SUM(debit) = SUM(credit)}. That single property is what
 * turns "the balance is wrong" from an unfalsifiable complaint into a query that
 * either returns zero rows or points at the exact broken transaction.
 *
 * <p>{@code balanceAfterMinor} is denormalised on purpose: it lets a statement be
 * rendered, and audited, without replaying the whole history of the account.
 */
@Entity
@Table(name = "ledger_entry")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LedgerEntry {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "transaction_id", length = 26, nullable = false, updatable = false)
    private String transactionId;

    @Column(name = "account_id", length = 26, nullable = false, updatable = false)
    private String accountId;

    @Enumerated(EnumType.STRING)
    @Column(name = "direction", length = 6, nullable = false, updatable = false)
    private LedgerDirection direction;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "currency", length = 3, nullable = false, updatable = false)
    private Currency currency;

    @Column(name = "balance_after_minor", nullable = false, updatable = false)
    private long balanceAfterMinor;

    @Enumerated(EnumType.STRING)
    @Column(name = "operation", length = 32, nullable = false, updatable = false)
    private LedgerOperation operation;

    @Column(name = "reference_type", length = 32, updatable = false)
    private String referenceType;

    @Column(name = "reference_id", length = 64, updatable = false)
    private String referenceId;

    @Column(name = "description", length = 255, updatable = false)
    private String description;

    @Column(name = "correlation_id", length = 64, updatable = false)
    private String correlationId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    // ------------------------------------------------------------------ factories

    public static LedgerEntry debit(String transactionId,
                                    Account account,
                                    long amountMinor,
                                    LedgerOperation operation,
                                    String referenceType,
                                    String referenceId,
                                    String description,
                                    String correlationId) {
        return create(transactionId, account, LedgerDirection.DEBIT, amountMinor, operation,
                referenceType, referenceId, description, correlationId);
    }

    public static LedgerEntry credit(String transactionId,
                                     Account account,
                                     long amountMinor,
                                     LedgerOperation operation,
                                     String referenceType,
                                     String referenceId,
                                     String description,
                                     String correlationId) {
        return create(transactionId, account, LedgerDirection.CREDIT, amountMinor, operation,
                referenceType, referenceId, description, correlationId);
    }

    private static LedgerEntry create(String transactionId,
                                      Account account,
                                      LedgerDirection direction,
                                      long amountMinor,
                                      LedgerOperation operation,
                                      String referenceType,
                                      String referenceId,
                                      String description,
                                      String correlationId) {
        LedgerEntry entry = new LedgerEntry();
        entry.id = Ulid.nextId();
        entry.transactionId = transactionId;
        entry.accountId = account.getId();
        entry.direction = direction;
        entry.amountMinor = amountMinor;
        entry.currency = account.getCurrency();
        entry.balanceAfterMinor = account.getBalanceMinor();
        entry.operation = operation;
        entry.referenceType = referenceType;
        entry.referenceId = referenceId;
        entry.description = description;
        entry.correlationId = correlationId;
        entry.createdAt = Instant.now();
        return entry;
    }

    /** Signed amount, convenient for reconciliation queries and statements. */
    public long signedAmountMinor() {
        return direction == LedgerDirection.CREDIT ? amountMinor : -amountMinor;
    }
}
