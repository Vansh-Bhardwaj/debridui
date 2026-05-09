import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watchHistory } from "@/lib/db/schema";
import { sql, eq, desc, and, count } from "drizzle-orm";

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

// POST /api/history — single-round-trip upsert.
// Called for pause/stop/complete milestones. Unique key is
// (user, imdb, type, season, episode); GREATEST() ensures
// progress/duration only ever grow.
export async function POST(request: NextRequest) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        const { imdbId, type, season, episode, fileName, progressSeconds, durationSeconds, eventType, sessionId } = body;

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

        // Ignore trivial blips so we don't spam the table.
        const minProgress = Math.min(10, safeDuration * 0.02);
        if (normalizedProgress < minProgress) {
            return NextResponse.json({ success: true, skipped: true });
        }

        await db
            .insert(watchHistory)
            .values({
                userId: session.user.id,
                imdbId,
                type,
                season: season ?? null,
                episode: episode ?? null,
                sessionId: sessionId ?? null,
                fileName: fileName ?? null,
                progressSeconds: normalizedProgress,
                durationSeconds: safeDuration,
                watchedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: [watchHistory.userId, watchHistory.imdbId, watchHistory.type, watchHistory.season, watchHistory.episode],
                set: {
                    progressSeconds: sql`GREATEST(${watchHistory.progressSeconds}, EXCLUDED.progress_seconds)`,
                    durationSeconds: sql`GREATEST(${watchHistory.durationSeconds}, EXCLUDED.duration_seconds)`,
                    fileName: sql`COALESCE(${watchHistory.fileName}, EXCLUDED.file_name)`,
                    sessionId: sql`COALESCE(EXCLUDED.session_id, ${watchHistory.sessionId})`,
                    watchedAt: sql`now()`,
                },
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
