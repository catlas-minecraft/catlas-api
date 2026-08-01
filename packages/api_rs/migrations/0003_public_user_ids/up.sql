ALTER TABLE core.users ADD COLUMN user_id text;

UPDATE core.users
SET user_id = 'user_' || id::text;

ALTER TABLE core.users
  ALTER COLUMN user_id SET NOT NULL,
  DROP CONSTRAINT users_username_key,
  ADD CONSTRAINT users_user_id_key UNIQUE (user_id),
  ADD CONSTRAINT users_user_id_format_check
    CHECK (user_id ~ '^[a-z0-9_-]{1,128}$');
