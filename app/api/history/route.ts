import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watchHistory } from "@/lib/db/schema";
import { eq, desc, and, count, isNull } from "drizzle-orm";

const HISTORY_MERGE_WINDOW_MS = 15 * 60 * 1000;
const HISTORY_RATE_WINDOW_MS = 60_000;
const HISTORY_MAX_WRITES_PER_WINDOW = 40;
const historyWriteTimestamps = new Map<string, number[]>();

function isHistoryRateLimited(userId: string): boolean {
    const now = Date.now();
    const existing = historyWriteTimestamps.get(userId) ?? [];
    const recent = existing.filter((ts) => now - ts < HISTORY_RATE_WINDOW_MS);
    if (recent.length >= HISTORY_MAX_WRITES_PER_WINDOW) return true;
    recent.push(now);
    historyWriteTimestamps.set(userId, recent);

    if (historyWriteTimestamps.size > 500) {
        for (const [key, values] of historyWriteTimestamps.entries()) {
            if (values.every((ts) => now - ts >= HISTORY_RATE_WINDOW_MS)) {
                historyWriteTimestamps.delete(key);
            }
        }
    }

    return false;
}

// GET /api/history?limit=20&offset=0 — paginated watch history, newest first
export async function GET(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20")));
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0"));

    try {
        const [history, [{ total }]] = await Promise.all([
            db
                .select()
                .from(watchHistory)
                .where(eq(watchHistory.userId, session.user.id))
                .orderBy(desc(watchHistory.watchedAt))
                .limit(limit)
                .offset(offset),
            db
                .select({ total: count() })
                .from(watchHistory)
                .where(eq(watchHistory.userId, session.user.id)),
        ]);

        return NextResponse.json({ history, total }, {
            headers: { "Cache-Control": "private, no-store" },
        });
    } catch (error) {
        console.error("[history] GET error:", error);
        return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }
}

// POST /api/history — log a completed/significant play session
// Called for pause/stop/complete session milestones.
export async function POST(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isHistoryRateLimited(session.user.id)) {
        return NextResponse.json(
            { error: "Too many history writes", retryAfterMs: 2000 },
            { status: 429, headers: { "Retry-After": "2" } }
        );
    }

    try {
        const body = await request.json() as {
            imdbId?: string;
            type?: string;
            season?: number;
            episode?: number;
            fileName?: string;
            progressSeconds?: number;
            durationSeconds?: number;
            eventType?: "pause" | "stop" | "complete" | "session_end";
            sessionId?: string;
        };
        const { imdbId, type, season, episode, fileName, progressSeconds, durationSeconds, eventType } = body;

        if (!imdbId || !type || typeof progressSeconds !== "number" || typeof durationSeconds !== "number") {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }
        if (type !== "movie" && type !== "show") {
            return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        if (eventType && !["pause", "stop", "complete", "session_end"].includes(eventType)) {
            return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
        }

        if (!Number.isFinite(progressSeconds) || !Number.isFinite(durationSeconds) || progressSeconds < 0 || durationSeconds <= 0) {
            return NextResponse.json({ error: "Invalid progress values" }, { status: 400 });
        }

        const safeProgress = Math.max(0, Math.round(progressSeconds));
        const safeDuration = Math.max(0, Math.round(durationSeconds));
        const normalizedProgress = eventType === "complete" ? safeDuration : safeProgress;

        // Capture short starts too (useful for "start now, resume later").
        const minProgress = Math.min(10, safeDuration * 0.02);
        if (normalizedProgress < minProgress) {
            return NextResponse.json({ success: true, skipped: true });
        }

        const conditions = [
            eq(watchHistory.userId, session.user.id),
            eq(watchHistory.imdbId, imdbId),
            eq(watchHistory.type, type),
        ];

        if (season == null) {
            conditions.push(isNull(watchHistory.season));
        } else {
            conditions.push(eq(watchHistory.season, season));
        }

        if (episode == null) {
            conditions.push(isNull(watchHistory.episode));
        } else {
            conditions.push(eq(watchHistory.episode, episode));
        }

        const [latest] = await db
            .select()
            .from(watchHistory)
            .where(and(...conditions))
            .orderBy(desc(watchHistory.watchedAt))
            .limit(1);

        if (latest && Date.now() - new Date(latest.watchedAt).getTime() <= HISTORY_MERGE_WINDOW_MS) {
            const progressDelta = Math.abs((latest.progressSeconds ?? 0) - normalizedProgress);
            const durationDelta = Math.abs((latest.durationSeconds ?? 0) - safeDuration);
            if (progressDelta <= 2 && durationDelta <= 2 && Date.now() - new Date(latest.watchedAt).getTime() <= 30_000) {
                return NextResponse.json({ success: true, deduped: true });
            }

            await db
                .update(watchHistory)
                .set({
                    progressSeconds: Math.max(latest.progressSeconds, normalizedProgress),
                    durationSeconds: Math.max(latest.durationSeconds, safeDuration),
                    fileName: latest.fileName ?? fileName ?? null,
                    watchedAt: new Date(),
                })
                .where(and(eq(watchHistory.id, latest.id), eq(watchHistory.userId, session.user.id)));

            return NextResponse.json({ success: true, merged: true });
        }

        await db.insert(watchHistory).values({
            userId: session.user.id,
            imdbId,
            type,
            season: season ?? null,
            episode: episode ?? null,
            fileName: fileName ?? null,
            progressSeconds: normalizedProgress,
            durationSeconds: safeDuration,
            watchedAt: new Date(),
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[history] POST error:", error);
        return NextResponse.json({ error: "Failed to save history" }, { status: 500 });
    }
}

// DELETE /api/history — delete a single entry (?id=uuid) or all entries (no params)
export async function DELETE(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = new URL(request.url).searchParams.get("id");

    try {
        if (id) {
            await db.delete(watchHistory).where(
                and(eq(watchHistory.id, id), eq(watchHistory.userId, session.user.id))
            );
        } else {
            await db.delete(watchHistory).where(eq(watchHistory.userId, session.user.id));
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[history] DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete history" }, { status: 500 });
    }
}
