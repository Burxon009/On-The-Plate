-- Профильные поля пользователя.
--
-- avatar_base64: фото профиля хранится ПРЯМО в БД как base64-строка
-- (обычно data URL "data:image/jpeg;base64,...."). На диск сервера не
-- пишем — у Render на бесплатном плане нет постоянного диска, файлы
-- исчезают при каждом рестарте. Картинка сжимается на клиенте (Canvas,
-- максимум 300x300, JPEG q0.7), поэтому строка компактная.
--
-- pending_email: адрес, на который запрошена смена email. Пока код с
-- нового адреса не подтверждён — основной users.email не меняется.
ALTER TABLE users
ADD COLUMN IF NOT EXISTS avatar_base64 TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS pending_email VARCHAR(255);

-- Раньше phone был логин-креденшлом (UNIQUE NOT NULL, миграция 001).
-- Теперь это просто информационное контактное поле — снимаем
-- уникальность, чтобы PATCH /users/me не падал на пересечениях.
ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_phone_key;
