import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { watchHistory } from "@/lib/db/schema";
import { eq, desc, and, count } from "drizzle-orm";

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
// Only called when >= 5% watched or >= 30 seconds watched (enforced client + server)
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
        };
        const { imdbId, type, season, episode, fileName, progressSeconds, durationSeconds } = body;

        if (!imdbId || !type || typeof progressSeconds !== "number" || typeof durationSeconds !== "number") {
            return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
        }
        if (type !== "movie" && type !== "show") {
            return NextResponse.json({ error: "Invalid type" }, { status: 400 });
        }

        // Server-side: require at least 30s watched OR 5% of duration
        const minProgress = durationSeconds > 0
            ? Math.min(30, durationSeconds * 0.05)
            : 30;
        if (progressSeconds < minProgress) {
            return NextResponse.json({ success: true, skipped: true });
        }

        await db.insert(watchHistory).values({
            userId: session.user.id,
            imdbId,
            type,
            season: season ?? null,
            episode: episode ?? null,
            fileName: fileName ?? null,
            progressSeconds: Math.round(progressSeconds),
            durationSeconds: Math.round(durationSeconds),
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
