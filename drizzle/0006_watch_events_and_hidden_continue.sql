-- Phase 2/3: playback event log + hide-vs-delete continue watching semantics

CREATE TABLE IF NOT EXISTS "hidden_continue_watching" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "imdb_id" text NOT NULL,
    "type" text NOT NULL CHECK (type IN ('movie', 'show')),
    "season" integer,
    "episode" integer,
    "hidden_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "unique_hidden_continue"
    ON "hidden_continue_watching" ("user_id", "imdb_id", "type", "season", "episode")
    NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS "hidden_continue_user_id_idx"
    ON "hidden_continue_watching" ("user_id");

CREATE TABLE IF NOT EXISTS "watch_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "imdb_id" text NOT NULL,
    "type" text NOT NULL CHECK (type IN ('movie', 'show')),
    "season" integer,
    "episode" integer,
    "session_id" text,
    "event_type" text NOT NULL,
    "idempotency_key" text NOT NULL,
    "progress_seconds" integer NOT NULL DEFAULT 0,
    "duration_seconds" integer NOT NULL DEFAULT 0,
    "progress_percent" integer NOT NULL DEFAULT 0,
    "player" text,
    "reason" text,
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "watch_events_idempotency_idx"
    ON "watch_events" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "watch_events_user_id_idx"
    ON "watch_events" ("user_id");

CREATE INDEX IF NOT EXISTS "watch_events_created_at_idx"
    ON "watch_events" ("created_at");
