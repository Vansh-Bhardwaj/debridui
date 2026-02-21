-- Watch history table: append-only log of completed/significant play sessions
-- Unlike user_progress (which tracks WHERE you are), this records THAT you watched
CREATE TABLE IF NOT EXISTS "watch_history" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "imdb_id" text NOT NULL,
    "type" text NOT NULL CHECK (type IN ('movie', 'show')),
    "season" integer,
    "episode" integer,
    "file_name" text,
    "progress_seconds" integer NOT NULL DEFAULT 0,
    "duration_seconds" integer NOT NULL DEFAULT 0,
    "watched_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "watch_history_user_id_idx" ON "watch_history" ("user_id");
CREATE INDEX IF NOT EXISTS "watch_history_watched_at_idx" ON "watch_history" ("watched_at");
