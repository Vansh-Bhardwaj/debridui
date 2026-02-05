import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userProgress } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

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

        return NextResponse.json({ progress });
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
        const season = searchParams.get("season");
        const episode = searchParams.get("episode");

        if (!imdbId) {
            return NextResponse.json({ error: "imdbId required" }, { status: 400 });
        }

        // Build conditions
        const conditions = [
            eq(userProgress.userId, session.user.id),
            eq(userProgress.imdbId, imdbId),
        ];

        if (season !== null) {
            conditions.push(eq(userProgress.season, parseInt(season)));
        }
        if (episode !== null) {
            conditions.push(eq(userProgress.episode, parseInt(episode)));
        }

        await db.delete(userProgress).where(and(...conditions));

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("[progress] DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete progress" }, { status: 500 });
    }
}
