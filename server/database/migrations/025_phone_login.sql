-- Вход по номеру телефона (через Telegram Gateway) наряду с email.
--
-- 1. Телефон снова становится логин-креденшлом. Частичный уникальный
--    индекс — уникальность ТОЛЬКО среди НЕ-NULL значений, чтобы старые
--    пользователи без телефона (их большинство) друг другу не мешали.
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique_idx
  ON users (phone)
  WHERE phone IS NOT NULL;

-- 2. verification_codes теперь обслуживает и телефонные коды. У кода с
--    телефона нет собственного хеша на нашей стороне — генерацию и
--    проверку делает Telegram Gateway, мы храним только request_id.
ALTER TABLE verification_codes
  ALTER COLUMN code_hash DROP NOT NULL;

ALTER TABLE verification_codes
  ADD COLUMN IF NOT EXISTS request_id VARCHAR(255);
