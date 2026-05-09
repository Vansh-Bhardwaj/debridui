-- Collapse watch_history to one row per (user, imdb, type, season, episode).
-- Previous semantics were append-only with a 3-hour merge window; in practice
-- that already produced mostly one row per key. This migration enforces it,
-- drops the per-request read+write pattern (now a single upsert), and makes the
-- /api/history write path free of round-trip select overhead.

-- Keep only the most recent row per key; older duplicates are discarded.
WITH keepers AS (
    SELECT DISTINCT ON (user_id, imdb_id, type, season, episode) id
    FROM watch_history
    ORDER BY user_id, imdb_id, type, season, episode, watched_at DESC
)
DELETE FROM watch_history
WHERE id NOT IN (SELECT id FROM keepers);

-- NULLS NOT DISTINCT ensures movies (season/episode=NULL) collapse correctly.
CREATE UNIQUE INDEX IF NOT EXISTS "unique_user_watch_history"
    ON "watch_history" ("user_id", "imdb_id", "type", "season", "episode")
    NULLS NOT DISTINCT;
