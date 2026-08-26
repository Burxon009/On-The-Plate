CREATE TABLE IF NOT EXISTS store_admins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, store_id)
);

CREATE INDEX IF NOT EXISTS store_admins_user_id_idx ON store_admins(user_id);
CREATE INDEX IF NOT EXISTS store_admins_store_id_idx ON store_admins(store_id);

-- Обратная совместимость: у нас уже есть admin-пользователи,
-- которые раньше управляли ВСЕМИ магазинами глобально
-- (в проверках была только role = 'admin', без привязки к store_id).
-- Чтобы существующий(-ие) admin не потерял(и) доступ прямо сейчас,
-- привязываем всех текущих admin ко всем текущим магазинам.
--
-- ВАЖНО: это разовая миграционная мера. Начиная с этой миграции,
-- НОВЫЕ магазины должны явно привязываться к конкретному admin
-- (это уже делает storeRoutes.ts при создании магазина),
-- а НОВЫЕ admin для существующих магазинов должны добавляться
-- вручную через отдельный запрос в store_admins.
INSERT INTO store_admins (user_id, store_id)
SELECT u.id, s.id
FROM users u
CROSS JOIN stores s
WHERE u.role = 'admin'
ON CONFLICT (user_id, store_id) DO NOTHING;
