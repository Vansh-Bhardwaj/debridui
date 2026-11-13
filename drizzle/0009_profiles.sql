-- Deploy atomically with the profile-aware application; never apply against local production DB.
BEGIN;
CREATE TABLE profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name text NOT NULL,
    avatar text,
    color text,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX profiles_user_id_idx ON profiles(user_id);
CREATE TABLE profile_settings (
    profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamp NOT NULL DEFAULT now()
);
INSERT INTO profiles (user_id, name)
SELECT id, COALESCE(NULLIF(btrim(name), ''), 'Default') FROM "user";

ALTER TABLE user_progress ADD COLUMN profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE user_progress t SET profile_id = p.id FROM profiles p WHERE p.user_id = t.user_id;
ALTER TABLE user_progress ALTER COLUMN profile_id SET NOT NULL;
DROP INDEX unique_user_progress;
CREATE UNIQUE INDEX unique_user_progress ON user_progress(user_id, profile_id, imdb_id, season, episode) NULLS NOT DISTINCT;

ALTER TABLE watch_history ADD COLUMN profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE watch_history t SET profile_id = p.id FROM profiles p WHERE p.user_id = t.user_id;
ALTER TABLE watch_history ALTER COLUMN profile_id SET NOT NULL;
DROP INDEX unique_user_watch_history;
CREATE UNIQUE INDEX unique_user_watch_history ON watch_history(user_id, profile_id, imdb_id, type, season, episode) NULLS NOT DISTINCT;

ALTER TABLE hidden_continue_watching ADD COLUMN profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE hidden_continue_watching t SET profile_id = p.id FROM profiles p WHERE p.user_id = t.user_id;
ALTER TABLE hidden_continue_watching ALTER COLUMN profile_id SET NOT NULL;
DROP INDEX unique_hidden_continue;
CREATE UNIQUE INDEX unique_hidden_continue ON hidden_continue_watching(user_id, profile_id, imdb_id, type, season, episode) NULLS NOT DISTINCT;

ALTER TABLE watch_events ADD COLUMN profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE;
UPDATE watch_events t SET profile_id = p.id FROM profiles p WHERE p.user_id = t.user_id;
ALTER TABLE watch_events ALTER COLUMN profile_id SET NOT NULL;
DROP INDEX watch_events_idempotency_idx;
CREATE UNIQUE INDEX watch_events_idempotency_idx ON watch_events(user_id, profile_id, idempotency_key) NULLS NOT DISTINCT;

INSERT INTO profile_settings (profile_id, settings)
SELECT p.id, COALESCE((SELECT jsonb_object_agg(key, value)
    FROM jsonb_each(s.settings) WHERE key IN ('trakt_access_token', 'trakt_refresh_token', 'trakt_expires_at')), '{}'::jsonb)
FROM profiles p LEFT JOIN user_settings s ON s.user_id = p.user_id;
UPDATE user_settings SET settings = settings - 'trakt_access_token' - 'trakt_refresh_token' - 'trakt_expires_at';
COMMIT;
