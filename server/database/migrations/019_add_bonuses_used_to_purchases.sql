ALTER TABLE purchases
ADD COLUMN bonuses_used BIGINT NOT NULL DEFAULT 0
    CHECK (bonuses_used >= 0);
