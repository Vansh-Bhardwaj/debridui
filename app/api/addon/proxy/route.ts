import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isBlockedUrl } from "@/lib/utils/url-safety";

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Server-side proxy for Stremio addon requests.
 * Avoids CORS issues entirely since requests originate from the server.
 * Requires authentication to prevent abuse as an open proxy.
 */
export async function GET(req: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    if (isBlockedUrl(url)) {
        return NextResponse.json({ error: "Blocked destination" }, { status: 403 });
    }

    try {
        const response = await fetch(url, {
            headers: {
                accept: "application/json, text/plain, */*",
                // Use a standard browser user-agent — some addons may limit
                // results for unrecognized user-agent strings
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                // Prevent upstream HTTP caching (AIOStreams, Cloudflare edge, etc.)
                "cache-control": "no-cache",
                "pragma": "no-cache",
            },
            redirect: "follow",
        });

        if (!response.ok) {
            return new NextResponse(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
            });
        }

        const data = await response.text();
        return new NextResponse(data, {
            status: 200,
            headers: {
                "content-type": response.headers.get("content-type") ?? "application/json",
                // No caching — stream results change frequently and can be partial
                // during initial aggregation by meta-addons (AIOStreams, etc.)
                "cache-control": "no-store",
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}` },
            { status: 502 }
        );
    }
}
