ALTER TABLE stores
ADD COLUMN IF NOT EXISTS cashback_percent NUMERIC(5,2) NOT NULL DEFAULT 1.00;

ALTER TABLE stores
ADD CONSTRAINT stores_cashback_percent_check
CHECK (cashback_percent >= 0 AND cashback_percent <= 100);
