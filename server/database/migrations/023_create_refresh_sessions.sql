-- Серверные refresh-сессии: ротация refresh-токенов, привязка к устройству
-- (user-agent / ip), цепочка replaced_by, отзыв (revoked_at).
-- sessionService.ts и authRoutes.ts (/auth/refresh, /auth/logout)
-- полностью полагаются на эту таблицу.
--
-- Таблица уже была создана в рабочей БД в обход системы миграций — этот
-- файл фиксирует её как обычную миграцию, чтобы на чистой базе структура
-- собиралась целиком. Все операции идемпотентны (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS refresh_sessions (
    id UUID PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    token_hash VARCHAR(128) NOT NULL UNIQUE,

    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,

    replaced_by UUID
        REFERENCES refresh_sessions(id),

    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP,

    user_agent VARCHAR(512),
    ip_address VARCHAR(64)
);

-- Быстрый поиск активных (не отозванных) сессий пользователя.
CREATE INDEX IF NOT EXISTS refresh_sessions_user_active_idx
    ON refresh_sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;
