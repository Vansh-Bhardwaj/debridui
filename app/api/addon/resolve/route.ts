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
 * Manually follow redirects, capturing each URL in the chain.
 * Returns the final URL plus the list of intermediate redirect URLs.
 */
async function followRedirects(url: string, maxRedirects = 10): Promise<{ finalUrl: string; chain: string[]; status: number }> {
    const chain: string[] = [];
    let currentUrl = url;
    let status = 200;

    for (let i = 0; i < maxRedirects; i++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const response = await fetch(currentUrl, {
                method: "HEAD",
                redirect: "manual",
                signal: controller.signal,
                headers: { "User-Agent": "DebridUI" },
            });
            clearTimeout(timeout);
            status = response.status;

            const location = response.headers.get("location");
            if (location && (status >= 300 && status < 400)) {
                // Resolve relative redirects
                const nextUrl = new URL(location, currentUrl).href;
                chain.push(currentUrl);
                currentUrl = nextUrl;
                continue;
            }

            // Not a redirect
            break;
        } catch {
            clearTimeout(timeout);

            // HEAD failed, try ranged GET
            const controller2 = new AbortController();
            const timeout2 = setTimeout(() => controller2.abort(), 5000);
            try {
                const response = await fetch(currentUrl, {
                    method: "GET",
                    redirect: "manual",
                    signal: controller2.signal,
                    headers: { Range: "bytes=0-0", "User-Agent": "DebridUI" },
                });
                clearTimeout(timeout2);
                status = response.status;
                try { response.body?.cancel(); } catch { /* no-op */ }

                const location = response.headers.get("location");
                if (location && (status >= 300 && status < 400)) {
                    const nextUrl = new URL(location, currentUrl).href;
                    chain.push(currentUrl);
                    currentUrl = nextUrl;
                    continue;
                }
                break;
            } catch (error) {
                clearTimeout(timeout2);
                if (error instanceof Error && error.name === "AbortError") {
                    throw new Error("Timeout");
                }
                throw error;
            }
        }
    }

    return { finalUrl: currentUrl, chain, status };
}

/**
 * Lightweight server-side URL resolver for addon stream URLs.
 * Follows redirect chains and returns the final destination URL,
 * plus any intermediate redirect URLs (useful for extracting debrid
 * provider parameters like torrent/file IDs).
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
        const { finalUrl, chain, status } = await followRedirects(url);

        return NextResponse.json({
            url: finalUrl,
            redirected: chain.length > 0,
            status,
            chain: chain.length > 0 ? chain : undefined,
        }, {
            headers: { "Cache-Control": "private, max-age=120" },
        });
    } catch (error) {
        if (error instanceof Error && error.message === "Timeout") {
            return NextResponse.json({ error: "Timeout" }, { status: 504 });
        }

        return NextResponse.json(
            { error: `Failed to resolve: ${error instanceof Error ? error.message : "Unknown"}` },
            { status: 502 },
        );
    }
}
