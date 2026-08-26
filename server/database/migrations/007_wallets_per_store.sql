ALTER TABLE wallets
ADD COLUMN store_id INTEGER;

ALTER TABLE wallets
ADD CONSTRAINT wallets_store_id_fkey
FOREIGN KEY (store_id)
REFERENCES stores(id)
ON DELETE CASCADE;

ALTER TABLE wallets
DROP CONSTRAINT wallets_user_id_key;

ALTER TABLE wallets
ADD CONSTRAINT wallets_user_store_key
UNIQUE (user_id, store_id);