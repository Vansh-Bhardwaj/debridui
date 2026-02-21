-- Fix: PostgreSQL unique index treats NULLs as distinct by default.
-- This caused ON CONFLICT DO UPDATE to never trigger for movies
-- (where season and episode are NULL), creating duplicate rows instead.

-- Step 1: Remove duplicate rows, keeping only the most recent per (user_id, imdb_id, season, episode)
DELETE FROM user_progress a
USING user_progress b
WHERE a.id <> b.id
  AND a.user_id = b.user_id
  AND a.imdb_id = b.imdb_id
  AND a.season IS NOT DISTINCT FROM b.season
  AND a.episode IS NOT DISTINCT FROM b.episode
  AND a.updated_at < b.updated_at;

-- Step 2: Drop the old unique index (NULLS DISTINCT by default)
DROP INDEX IF EXISTS unique_user_progress;

-- Step 3: Recreate with NULLS NOT DISTINCT so ON CONFLICT works for movies
CREATE UNIQUE INDEX unique_user_progress
  ON user_progress(user_id, imdb_id, season, episode)
  NULLS NOT DISTINCT;
