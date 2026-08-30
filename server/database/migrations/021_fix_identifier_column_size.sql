-- Миграция 020 переименовала phone -> identifier, но не расширила размер
-- колонки — она осталась VARCHAR(20) (был рассчитан под номер телефона).
-- Email-адреса длиннее, из-за чего запрос кода падал с ошибкой
-- "value too large for type character varying(20)".
ALTER TABLE verification_codes
ALTER COLUMN identifier TYPE VARCHAR(255);

-- users.email тоже на всякий случай проверим/оставим достаточным
-- (уже был создан как VARCHAR(255) в migration 020 — здесь не трогаем).
