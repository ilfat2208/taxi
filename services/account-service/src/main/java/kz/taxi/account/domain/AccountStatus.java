package kz.taxi.account.domain;

/** Lifecycle of an account. Only {@link #ACTIVE} accounts can move money. */
public enum AccountStatus {

    ACTIVE,

    /** Frozen by an operator (fraud, dispute): reads work, money does not move. */
    FROZEN,

    /** Closed by the owner: terminal, only historical reads remain. */
    CLOSED
}
