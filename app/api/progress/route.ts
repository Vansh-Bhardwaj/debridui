import { NextRequest, NextResponse } from "next/server";
import { getActor, UnauthorizedError } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { hiddenContinueWatching, userProgress } from "@/lib/db/schema";
import { eq, and, desc, isNull, lt, lte, or, type SQL } from "drizzle-orm";

// ── Rate limiter (per-profile, in-memory) ────────────────────────────────────
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
    profileId: string,
    imdbId: string,
    type: "movie" | "show" | null,
    season: number,
    episode: number
) {
    const conditions = [
        eq(userProgress.userId, userId),
        eq(userProgress.profileId, profileId),
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
    profileId: string,
    imdbId: string,
    type: "movie" | "show" | null,
    season: number,
    episode: number
) {
    const conditions = [
        eq(hiddenContinueWatching.userId, userId),
        eq(hiddenContinueWatching.profileId, profileId),
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

/**
 * A finished episode makes every earlier episode's cursor stale. Clearing them stops
 * Continue Watching from falling back to an old half-watched episode (e.g. S3E1)
 * once the latest one is done. Movies / non-episodes: just this item.
 */
function completedProgressConditions(userId: string, profileId: string, imdbId: string, type: "movie" | "show" | null, season: number, episode: number): SQL[] {
    if (type !== "show" || Number.isNaN(season) || Number.isNaN(episode)) {
        return buildProgressConditions(userId, profileId, imdbId, type, season, episode);
    }
    return [
        eq(userProgress.userId, userId),
        eq(userProgress.profileId, profileId),
        eq(userProgress.imdbId, imdbId),
        eq(userProgress.type, "show"),
        or(lt(userProgress.season, season), and(eq(userProgress.season, season), lte(userProgress.episode, episode)))!,
    ];
}

// GET /api/progress              → all user progress (continue watching list)
// GET /api/progress?imdbId=...  → single item (cross-device resume lookup)
export async function GET(request: NextRequest) {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) {
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
                and(eq(userProgress.userId, actor.userId), eq(userProgress.profileId, actor.profileId)),
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
                .where(and(eq(userProgress.userId, actor.userId), eq(userProgress.profileId, actor.profileId)))
                .orderBy(desc(userProgress.updatedAt))
                .limit(limit),
            db
                .select({ id: hiddenContinueWatching.id, imdbId: hiddenContinueWatching.imdbId, type: hiddenContinueWatching.type, season: hiddenContinueWatching.season, episode: hiddenContinueWatching.episode })
                .from(hiddenContinueWatching)
                .where(and(eq(hiddenContinueWatching.userId, actor.userId), eq(hiddenContinueWatching.profileId, actor.profileId))),
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
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Server-side rate limit: bounded burst per profile
    if (isRateLimited(`${actor.userId}:${actor.profileId}`)) {
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
        };
        const { imdbId, type, season, episode, progressSeconds, durationSeconds, eventType } = body;

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
            const conditions = completedProgressConditions(
                actor.userId,
                actor.profileId,
                imdbId,
                normalizedType,
                safeSeason ?? NaN,
                safeEpisode ?? NaN
            );
            const hiddenConditions = buildHiddenConditions(
                actor.userId,
                actor.profileId,
                imdbId,
                normalizedType,
                safeSeason ?? NaN,
                safeEpisode ?? NaN
            );

            // Two deletes run in parallel — one round-trip total
            await Promise.all([
                db.delete(userProgress).where(and(...conditions)),
                db.delete(hiddenContinueWatching).where(and(...hiddenConditions)),
            ]);

            return NextResponse.json({ success: true, completed: true });
        }

        // Heartbeats are a single upsert. Un-hiding a shelf entry only needs to
        // happen once per session, so it rides on the pause/stop/end events.
        if (normalizedEventType !== "play_progress") {
            await db.delete(hiddenContinueWatching).where(and(...buildHiddenConditions(
                actor.userId,
                actor.profileId,
                imdbId,
                normalizedType,
                safeSeason ?? NaN,
                safeEpisode ?? NaN
            )));
        }

        // Single round-trip upsert.
        await db
            .insert(userProgress)
            .values({
                userId: actor.userId,
                profileId: actor.profileId,
                imdbId,
                type: normalizedType,
                season: safeSeason,
                episode: safeEpisode,
                progressSeconds: safeProgressSeconds,
                durationSeconds: safeDurationSeconds,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [userProgress.userId, userProgress.profileId, userProgress.imdbId, userProgress.season, userProgress.episode],
                set: {
                    progressSeconds: safeProgressSeconds,
                    durationSeconds: safeDurationSeconds,
                    updatedAt: new Date(),
                },
            });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[progress] POST error:", error);
        return NextResponse.json({ error: "Failed to save progress" }, { status: 500 });
    }
}

// DELETE /api/progress - Clear progress for a specific item
export async function DELETE(request: NextRequest) {
    const actor = await getActor().catch((error) => {
        if (error instanceof UnauthorizedError) return null;
        throw error;
    });
    if (!actor) {
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

        const nextSeasonRaw = searchParams.get("nextSeason");
        const nextEpisodeRaw = searchParams.get("nextEpisode");
        const nextSeason = nextSeasonRaw ? parseInt(nextSeasonRaw) : NaN;
        const nextEp = nextEpisodeRaw ? parseInt(nextEpisodeRaw) : NaN;

        const progressConditions = buildProgressConditions(actor.userId, actor.profileId, imdbId, type, season, episode);
        const hiddenConditions = buildHiddenConditions(actor.userId, actor.profileId, imdbId, type, season, episode);

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
                    userId: actor.userId,
                    profileId: actor.profileId,
                    imdbId,
                    type: resolvedType,
                    season: Number.isNaN(season) ? null : season,
                    episode: Number.isNaN(episode) ? null : episode,
                    hiddenAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [hiddenContinueWatching.userId, hiddenContinueWatching.profileId, hiddenContinueWatching.imdbId, hiddenContinueWatching.type, hiddenContinueWatching.season, hiddenContinueWatching.episode],
                    set: { hiddenAt: new Date() },
                });

            return NextResponse.json({ success: true, mode: "hide" });
        }

        // Completion (a next episode is given): also clear stale earlier episodes, then seed the next.
        const shouldSeedNext = type === "show" && !Number.isNaN(nextSeason) && !Number.isNaN(nextEp);
        const ops: Promise<unknown>[] = [
            db.delete(userProgress).where(and(...(shouldSeedNext
                ? completedProgressConditions(actor.userId, actor.profileId, imdbId, type, season, episode)
                : progressConditions))),
            db.delete(hiddenContinueWatching).where(and(...hiddenConditions)),
        ];

        // Seed next episode cursor at 0 seconds so Continue Watching advances
        if (shouldSeedNext) {
            ops.push(
                db.insert(userProgress).values({
                    userId: actor.userId,
                    profileId: actor.profileId,
                    imdbId,
                    type: "show",
                    season: nextSeason,
                    episode: nextEp,
                    progressSeconds: 0,
                    durationSeconds: 1, // placeholder — overwritten on actual playback
                    updatedAt: new Date(),
                }).onConflictDoUpdate({
                    target: [userProgress.userId, userProgress.profileId, userProgress.imdbId, userProgress.season, userProgress.episode],
                    set: {
                        progressSeconds: 0,
                        durationSeconds: 1,
                        updatedAt: new Date(),
                    },
                })
            );
        }

        await Promise.all(ops);

        return NextResponse.json({ success: true, mode: "delete", nextSeeded: shouldSeedNext });
    } catch (error) {
        console.error("[progress] DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete progress" }, { status: 500 });
    }
}
