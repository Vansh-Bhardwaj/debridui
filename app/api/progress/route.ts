import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hiddenContinueWatching, userProgress, watchEvents } from "@/lib/db/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

// ── Rate limiter (per-user, in-memory) ────────────────────────────────────
// Protects Hyperdrive free tier (100K queries/day) from misbehaving clients.
// Normal usage is heartbeat writes + pause/end flushes; allows burst capacity.
const writeTimestamps = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 30;

function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const timestamps = writeTimestamps.get(userId) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= MAX_WRITES_PER_WINDOW) return true;
    recent.push(now);
    writeTimestamps.set(userId, recent);
    // Periodic cleanup: remove expired entries when map grows large
    if (writeTimestamps.size > 500) {
        for (const [key, ts] of writeTimestamps) {
            if (ts.every((t) => now - t >= RATE_WINDOW_MS)) writeTimestamps.delete(key);
        }
    }
    return false;
}

function buildProgressConditions(
    userId: string,
    imdbId: string,
    type: "movie" | "show" | null,
    season: number,
    episode: number
) {
    const conditions = [
        eq(userProgress.userId, userId),
        eq(userProgress.imdbId, imdbId),
    ];

    if (type === "movie" || type === "show") {
        conditions.push(eq(userProgress.type, type));
    }
    if (!Number.isNaN(season)) {
        conditions.push(eq(userProgress.season, season));
    }
    if (!Number.isNaN(episode)) {
        conditions.push(eq(userProgress.episode, episode));
    }

    return conditions;
}

function buildHiddenConditions(
    userId: string,
    imdbId: string,
    type: "movie" | "show" | null,
    season: number,
    episode: number
) {
    const conditions = [
        eq(hiddenContinueWatching.userId, userId),
        eq(hiddenContinueWatching.imdbId, imdbId),
    ];

    if (type === "movie" || type === "show") {
        conditions.push(eq(hiddenContinueWatching.type, type));
    }
    if (!Number.isNaN(season)) {
        conditions.push(eq(hiddenContinueWatching.season, season));
    } else {
        conditions.push(isNull(hiddenContinueWatching.season));
    }
    if (!Number.isNaN(episode)) {
        conditions.push(eq(hiddenContinueWatching.episode, episode));
    } else {
        conditions.push(isNull(hiddenContinueWatching.episode));
    }

    return conditions;
}

// GET /api/progress              → all user progress (continue watching list)
// GET /api/progress?imdbId=...  → single item (cross-device resume lookup)
export async function GET(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const imdbId = searchParams.get("imdbId");
        const type = searchParams.get("type") as "movie" | "show" | null;

        if (imdbId) {
            // Single-item lookup for cross-device resume
            const seasonRaw = searchParams.get("season");
            const episodeRaw = searchParams.get("episode");
            const season = seasonRaw ? parseInt(seasonRaw) : NaN;
            const episode = episodeRaw ? parseInt(episodeRaw) : NaN;

            const conditions = [
                eq(userProgress.userId, session.user.id),
                eq(userProgress.imdbId, imdbId),
            ];
            if (type === "movie" || type === "show") {
                conditions.push(eq(userProgress.type, type));
            }
            if (!isNaN(season)) conditions.push(eq(userProgress.season, season));
            if (!isNaN(episode)) conditions.push(eq(userProgress.episode, episode));

            const [item] = await db
                .select()
                .from(userProgress)
                .where(and(...conditions))
                .limit(1);

            return NextResponse.json({ progress: item ?? null }, {
                headers: { "Cache-Control": "private, no-store" },
            });
        }

        const limitRaw = parseInt(searchParams.get("limit") ?? "200");
        const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;

        const [progress, hidden] = await Promise.all([
            db
                .select()
                .from(userProgress)
                .where(eq(userProgress.userId, session.user.id))
                .orderBy(desc(userProgress.updatedAt))
                .limit(limit),
            db
                .select({ id: hiddenContinueWatching.id, imdbId: hiddenContinueWatching.imdbId, type: hiddenContinueWatching.type, season: hiddenContinueWatching.season, episode: hiddenContinueWatching.episode })
                .from(hiddenContinueWatching)
                .where(eq(hiddenContinueWatching.userId, session.user.id)),
        ]);

        const hiddenKeys = new Set(hidden.map((item) => `${item.imdbId}:${item.type}:${item.season ?? "_"}:${item.episode ?? "_"}`));

        const filtered = progress.filter((item) => !hiddenKeys.has(`${item.imdbId}:${item.type}:${item.season ?? "_"}:${item.episode ?? "_"}`));

        return NextResponse.json({ progress: filtered }, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[progress] GET error:", error);
        return NextResponse.json({ error: "Failed to fetch progress" }, { status: 500 });
    }
}

// POST /api/progress - Upsert progress (optimized for coarse updates)
export async function POST(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Server-side rate limit: bounded burst per user
    if (isRateLimited(session.user.id)) {
        return NextResponse.json(
            { error: "Too many requests", retryAfterMs: 2000 },
            { status: 429, headers: { "Retry-After": "2" } }
        );
    }

    try {
        const body = await request.json() as {
            imdbId?: string;
            type?: string;
            season?: number;
            episode?: number;
            progressSeconds?: number;
            durationSeconds?: number;
            eventType?: "play_progress" | "play_pause" | "play_stop" | "play_complete" | "session_end";
            sessionId?: string;
            idempotencyKey?: string;
            player?: string;
            reason?: string;
        };
        const { imdbId, type, season, episode, progressSeconds, durationSeconds, eventType, sessionId, idempotencyKey, player, reason } = body;

        // Validate required fields
        if (!imdbId || !type || typeof progressSeconds !== "number" || typeof durationSeconds !== "number") {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }

        // Validate type
        if (type !== "movie" && type !== "show") {
            return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        if (!Number.isFinite(progressSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || progressSeconds < 0) {
            return NextResponse.json({ error: "Invalid progress values" }, { status: 400 });
        }

        const safeProgressSeconds = Math.max(0, Math.round(progressSeconds));
        const safeDurationSeconds = Math.max(0, Math.round(durationSeconds));
        const progressPercent = safeDurationSeconds > 0 ? (safeProgressSeconds / safeDurationSeconds) * 100 : 0;

        const normalizedType = type as "movie" | "show";
        const safeSeason = typeof season === "number" && Number.isFinite(season) ? season : null;
        const safeEpisode = typeof episode === "number" && Number.isFinite(episode) ? episode : null;
        const normalizedEventType = eventType ?? "play_progress";

        // Completion clears cursor and un-hides any hidden shelf entry for this key.
        if (progressPercent >= 95) {
            const conditions = buildProgressConditions(
                session.user.id,
                imdbId,
                normalizedType,
                safeSeason ?? NaN,
                safeEpisode ?? NaN
            );
            const hiddenConditions = buildHiddenConditions(
                session.user.id,
                imdbId,
                normalizedType,
                safeSeason ?? NaN,
                safeEpisode ?? NaN
            );

            const dedupe = idempotencyKey ?? `${session.user.id}:${imdbId}:${normalizedType}:${safeSeason ?? "_"}:${safeEpisode ?? "_"}:${eventType ?? "play_complete"}:${Math.floor(Date.now() / 1000)}`;
            // All three operations are independent — run in parallel (3→1 round-trip)
            await Promise.all([
                db.delete(userProgress).where(and(...conditions)),
                db.delete(hiddenContinueWatching).where(and(...hiddenConditions)),
                db.insert(watchEvents).values({
                    userId: session.user.id,
                    imdbId,
                    type: normalizedType,
                    season: safeSeason,
                    episode: safeEpisode,
                    sessionId: sessionId ?? null,
                    eventType: normalizedEventType,
                    idempotencyKey: dedupe,
                    progressSeconds: safeProgressSeconds,
                    durationSeconds: safeDurationSeconds,
                    progressPercent: Math.min(100, Math.max(0, Math.round(progressPercent))),
                    player: player ?? null,
                    reason: reason ?? null,
                    createdAt: new Date(),
                }).onConflictDoNothing({ target: watchEvents.idempotencyKey }),
            ]);

            return NextResponse.json({ success: true, completed: true });
        }

        // If user resumed playback, bring hidden entries back into the shelf.
        // Run hidden delete + dedup check in parallel (2→1 round-trip)
        const hiddenConditions = buildHiddenConditions(
            session.user.id,
            imdbId,
            normalizedType,
            safeSeason ?? NaN,
            safeEpisode ?? NaN
        );

        const progressConditions = buildProgressConditions(
            session.user.id,
            imdbId,
            normalizedType,
            safeSeason ?? NaN,
            safeEpisode ?? NaN
        );

        const [, existingRows] = await Promise.all([
            db.delete(hiddenContinueWatching).where(and(...hiddenConditions)),
            normalizedEventType === "play_progress"
                ? db
                    .select({ progressSeconds: userProgress.progressSeconds, durationSeconds: userProgress.durationSeconds, updatedAt: userProgress.updatedAt })
                    .from(userProgress)
                    .where(and(...progressConditions))
                    .limit(1)
                : Promise.resolve([]),
        ]);

        // Skip redundant heartbeat writes when the position hasn't meaningfully changed.
        if (normalizedEventType === "play_progress" && existingRows.length > 0) {
            const previous = existingRows[0];
            const progressDelta = Math.abs((previous.progressSeconds ?? 0) - safeProgressSeconds);
            const durationDelta = Math.abs((previous.durationSeconds ?? 0) - safeDurationSeconds);
            const ageMs = Date.now() - new Date(previous.updatedAt).getTime();

            if (progressDelta <= 2 && durationDelta <= 2 && ageMs < 10_000) {
                return NextResponse.json({ success: true, deduped: true });
            }
        }

        const dedupe = idempotencyKey ?? `${session.user.id}:${imdbId}:${normalizedType}:${safeSeason ?? "_"}:${safeEpisode ?? "_"}:${normalizedEventType}:${Math.floor(Date.now() / 5_000)}`;
        // Upsert progress + insert event in parallel (2→1 round-trip)
        await Promise.all([
            db
                .insert(userProgress)
                .values({
                    userId: session.user.id,
                    imdbId,
                    type: normalizedType,
                    season: safeSeason,
                    episode: safeEpisode,
                    progressSeconds: safeProgressSeconds,
                    durationSeconds: safeDurationSeconds,
                    updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [userProgress.userId, userProgress.imdbId, userProgress.season, userProgress.episode],
                    set: {
                        progressSeconds: safeProgressSeconds,
                        durationSeconds: safeDurationSeconds,
                        updatedAt: new Date(),
                    },
                }),
            db.insert(watchEvents).values({
                userId: session.user.id,
                imdbId,
                type: normalizedType,
                season: safeSeason,
                episode: safeEpisode,
                sessionId: sessionId ?? null,
                eventType: normalizedEventType,
                idempotencyKey: dedupe,
                progressSeconds: safeProgressSeconds,
                durationSeconds: safeDurationSeconds,
                progressPercent: Math.min(100, Math.max(0, Math.round(progressPercent))),
                player: player ?? null,
                reason: reason ?? null,
                createdAt: new Date(),
            }).onConflictDoNothing({ target: watchEvents.idempotencyKey }),
        ]);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[progress] POST error:", error);
        return NextResponse.json({ error: "Failed to save progress" }, { status: 500 });
    }
}

// DELETE /api/progress - Clear progress for a specific item
export async function DELETE(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const imdbId = searchParams.get("imdbId");
        const type = searchParams.get("type") as "movie" | "show" | null;
        const seasonRaw = searchParams.get("season");
        const episodeRaw = searchParams.get("episode");
        const mode = searchParams.get("mode") as "hide" | "delete" | null;

        if (!imdbId) {
            return NextResponse.json({ error: "imdbId required" }, { status: 400 });
        }

        // Parse season/episode — ignore invalid values like "null", "undefined", NaN
        const season = seasonRaw ? parseInt(seasonRaw) : NaN;
        const episode = episodeRaw ? parseInt(episodeRaw) : NaN;

        const progressConditions = buildProgressConditions(session.user.id, imdbId, type, season, episode);
        const hiddenConditions = buildHiddenConditions(session.user.id, imdbId, type, season, episode);

        if (mode === "hide") {
            const progressRows = await db
                .select({ type: userProgress.type, season: userProgress.season, episode: userProgress.episode })
                .from(userProgress)
                .where(and(...progressConditions))
                .limit(1);

            const resolvedType = (type === "movie" || type === "show")
                ? type
                : progressRows[0]?.type ?? "movie";

            await db
                .insert(hiddenContinueWatching)
                .values({
                    userId: session.user.id,
                    imdbId,
                    type: resolvedType,
                    season: Number.isNaN(season) ? null : season,
                    episode: Number.isNaN(episode) ? null : episode,
                    hiddenAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [hiddenContinueWatching.userId, hiddenContinueWatching.imdbId, hiddenContinueWatching.type, hiddenContinueWatching.season, hiddenContinueWatching.episode],
                    set: { hiddenAt: new Date() },
                });

            return NextResponse.json({ success: true, mode: "hide" });
        }

        await Promise.all([
            db.delete(userProgress).where(and(...progressConditions)),
            db.delete(hiddenContinueWatching).where(and(...hiddenConditions)),
        ]);

        return NextResponse.json({ success: true, mode: "delete" });
    } catch (error) {
        console.error("[progress] DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete progress" }, { status: 500 });
    }
}
