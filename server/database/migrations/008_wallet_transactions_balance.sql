ALTER TABLE wallet_transactions
ADD COLUMN balance_after BIGINT NOT NULL DEFAULT 0;

ALTER TABLE wallet_transactions
ADD CONSTRAINT wallet_transactions_type_check
CHECK (type IN ('cashback', 'spend', 'adjustment'));