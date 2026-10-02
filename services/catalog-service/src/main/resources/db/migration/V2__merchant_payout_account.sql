-- ---------------------------------------------------------------------------
-- Merchant payouts.
--
-- Until now a merchant could sell but had no say in where the money goes, so
-- settlement had nowhere to send it. The account is chosen by the merchant, not
-- derived by the platform: paying out to a guessed account means sending someone
-- else's money to a stranger.
--
-- Nullable on purpose — a merchant may sell before configuring a payout account.
-- Settlement then records the debt as PENDING instead of paying it, so the money
-- owed is visible rather than lost.
-- ---------------------------------------------------------------------------

ALTER TABLE merchant ADD COLUMN payout_account_id VARCHAR(26);

COMMENT ON COLUMN merchant.payout_account_id IS
    'account-service account id the platform pays this merchant into; NULL means settlement stays PENDING';

-- Finding merchants that still owe a payout account is an operational query
-- ("who can we not pay?"), and it only ever looks at the non-null rows.
CREATE INDEX idx_merchant_payout_account ON merchant (payout_account_id)
    WHERE payout_account_id IS NOT NULL;
