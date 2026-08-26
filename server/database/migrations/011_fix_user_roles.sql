UPDATE users
SET role = 'client'
WHERE role = 'customer';

ALTER TABLE users
ALTER COLUMN role SET DEFAULT 'client';

ALTER TABLE users
ADD CONSTRAINT users_role_check
CHECK (role IN ('client', 'admin'));