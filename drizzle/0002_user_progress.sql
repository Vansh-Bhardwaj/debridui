-- User progress table for continue watching feature
-- Optimized: uses upsert with coarse 60s intervals to minimize writes
CREATE TABLE user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    imdb_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('movie', 'show')),
    season INTEGER,
    episode INTEGER,
    progress_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, imdb_id, season, episode)
);

-- Index for fetching user's progress list efficiently
CREATE INDEX user_progress_user_id_idx ON user_progress(user_id);

-- Index for sorting by most recently watched
CREATE INDEX user_progress_updated_at_idx ON user_progress(updated_at DESC);
