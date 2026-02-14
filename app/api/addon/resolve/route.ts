import { NextResponse } from "next/server";

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Lightweight server-side URL resolver for addon stream URLs.
 * Follows redirect chains and returns the final destination URL.
 *
 * Many Stremio addons (Torrentio, Comet, etc.) return proxy URLs that redirect
 * to the actual debrid download link. The browser's <video> element can sometimes
 * fail to follow these redirects. This endpoint resolves the chain server-side
 * and returns the final direct URL for reliable playback.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
        // HEAD first — cheapest way to resolve redirects
        const response = await fetch(url, {
            method: "HEAD",
            redirect: "follow",
            signal: controller.signal,
            headers: { "User-Agent": "DebridUI" },
        });

        clearTimeout(timeout);

        return NextResponse.json({
            url: response.url,
            redirected: response.redirected,
            status: response.status,
        }, {
            headers: { "Cache-Control": "private, max-age=120" },
        });
    } catch {
        clearTimeout(timeout);

        // HEAD might not be allowed — retry with ranged GET
        const controller2 = new AbortController();
        const timeout2 = setTimeout(() => controller2.abort(), 8000);

        try {
            const response = await fetch(url, {
                method: "GET",
                redirect: "follow",
                signal: controller2.signal,
                headers: { Range: "bytes=0-0", "User-Agent": "DebridUI" },
            });

            clearTimeout(timeout2);

            // Don't consume the body
            try { response.body?.cancel(); } catch { /* no-op */ }

            return NextResponse.json({
                url: response.url,
                redirected: response.redirected,
                status: response.status,
            }, {
                headers: { "Cache-Control": "private, max-age=120" },
            });
        } catch (error) {
            clearTimeout(timeout2);

            if (error instanceof Error && error.name === "AbortError") {
                return NextResponse.json({ error: "Timeout" }, { status: 504 });
            }

            return NextResponse.json(
                { error: `Failed to resolve: ${error instanceof Error ? error.message : "Unknown"}` },
                { status: 502 },
            );
        }
    }
}
