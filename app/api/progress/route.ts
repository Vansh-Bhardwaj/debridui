import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProgress } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

// ── Rate limiter (per-user, in-memory) ────────────────────────────────────
// Protects Hyperdrive free tier (100K queries/day) from misbehaving clients.
// Normal usage is 1 write/60s per user; allows burst of 5 writes/minute.
const writeTimestamps = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const MAX_WRITES_PER_WINDOW = 5;

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

// GET /api/progress - Fetch all user progress for continue watching
export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const progress = await db
            .select()
            .from(userProgress)
            .where(eq(userProgress.userId, session.user.id))
            .orderBy(desc(userProgress.updatedAt))
            .limit(50); // Limit to recent 50 items

        return NextResponse.json({ progress }, {
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

    // Server-side rate limit: max 5 writes/minute per user
    if (isRateLimited(session.user.id)) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    try {
        const body = await request.json() as {
            imdbId?: string;
            type?: string;
            season?: number;
            episode?: number;
            progressSeconds?: number;
            durationSeconds?: number;
        };
        const { imdbId, type, season, episode, progressSeconds, durationSeconds } = body;

        // Validate required fields
        if (!imdbId || !type || typeof progressSeconds !== "number" || typeof durationSeconds !== "number") {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }

        // Validate type
        if (type !== "movie" && type !== "show") {
            return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        // Upsert using ON CONFLICT - single efficient query
        await db
            .insert(userProgress)
            .values({
                userId: session.user.id,
                imdbId,
                type,
                season: season ?? null,
                episode: episode ?? null,
                progressSeconds: Math.round(progressSeconds),
                durationSeconds: Math.round(durationSeconds),
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [userProgress.userId, userProgress.imdbId, userProgress.season, userProgress.episode],
                set: {
                    progressSeconds: Math.round(progressSeconds),
                    durationSeconds: Math.round(durationSeconds),
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
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const { searchParams } = new URL(request.url);
        const imdbId = searchParams.get("imdbId");
        const seasonRaw = searchParams.get("season");
        const episodeRaw = searchParams.get("episode");

        if (!imdbId) {
            return NextResponse.json({ error: "imdbId required" }, { status: 400 });
        }

        // Parse season/episode — ignore invalid values like "null", "undefined", NaN
        const season = seasonRaw ? parseInt(seasonRaw) : NaN;
        const episode = episodeRaw ? parseInt(episodeRaw) : NaN;

        // Build conditions
        const conditions = [
            eq(userProgress.userId, session.user.id),
            eq(userProgress.imdbId, imdbId),
        ];

        if (!isNaN(season)) {
            conditions.push(eq(userProgress.season, season));
        }
        if (!isNaN(episode)) {
            conditions.push(eq(userProgress.episode, episode));
        }

        await db.delete(userProgress).where(and(...conditions));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[progress] DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete progress" }, { status: 500 });
    }
}
