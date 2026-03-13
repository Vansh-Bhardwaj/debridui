-- Session-aware history merging: keep long continuous runs in one history row

ALTER TABLE "watch_history"
ADD COLUMN IF NOT EXISTS "session_id" text;

CREATE INDEX IF NOT EXISTS "watch_history_session_id_idx"
    ON "watch_history" ("session_id");
