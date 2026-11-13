CREATE TABLE profile_watchlist (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_id text NOT NULL,
    type text NOT NULL CHECK (type IN ('movie', 'show')),
    media jsonb NOT NULL,
    added_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profile_watchlist_unique ON profile_watchlist (user_id, profile_id, type, media_id) NULLS NOT DISTINCT;
