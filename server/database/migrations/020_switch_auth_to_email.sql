-- Переход авторизации с телефона на email.
--
-- phone делаем необязательным (не удаляем колонку и не трогаем
-- существующие данные — старые пользователи с телефоном остаются
-- как есть, просто больше не логинятся по нему).
ALTER TABLE users
ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE users
ADD COLUMN email VARCHAR(255) UNIQUE;

-- Таблица кодов подтверждения раньше хранила только телефон.
-- Переименовываем колонку в общее "identifier", чтобы туда
-- писался email (та же логика генерации/проверки кода, что и раньше,
-- просто теперь identifier — это email, а не номер телефона).
ALTER TABLE verification_codes
RENAME COLUMN phone TO identifier;
