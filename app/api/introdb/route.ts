import { NextResponse } from "next/server";

/**
 * Server-side proxy for IntroDB API segment lookups.
 * The IntroDB API only allows CORS from https://introdb.app, so browser
 * fetches are blocked. This proxy forwards the request server-side.
 * No auth required — the data is publicly available.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const imdbId = searchParams.get("imdb_id") ?? "";
    const season = searchParams.get("season") ?? "";
    const episode = searchParams.get("episode") ?? "";

    // Validate imdb_id format
    if (!/^tt\d{7,8}$/.test(imdbId) || !season || !episode) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const upstream = `https://api.introdb.app/segments?imdb_id=${imdbId}&season=${season}&episode=${episode}`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const res = await fetch(upstream, {
                headers: { accept: "application/json" },
                signal: controller.signal,
            });

            if (res.status === 404) {
                return NextResponse.json(null, { status: 404 });
            }

            if (!res.ok) {
                return NextResponse.json({ error: "IntroDB upstream error" }, { status: res.status });
            }

            const data = await res.text();
            return new NextResponse(data, {
                status: 200,
                headers: {
                    "content-type": "application/json",
                    // Cache responses for 6 hours — segment timestamps rarely change
                    "cache-control": "public, max-age=21600, stale-while-revalidate=3600",
                },
            });
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
        }
        return NextResponse.json({ error: "Proxy failed" }, { status: 502 });
    }
}
