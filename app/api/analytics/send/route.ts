import { NextRequest, NextResponse } from "next/server";

const CLOUDFLARE_SEND_URL = "https://cloudflareinsights.com/cdn-cgi/rum";

export async function POST(request: NextRequest) {
    try {
        const body = await request.text();
        // Forward relevant headers for accurate analytics attribution
        const forwardHeaders: Record<string, string> = {
            "Content-Type": request.headers.get("Content-Type") ?? "application/json",
        };
        for (const header of ["User-Agent", "Referer", "Origin", "Accept-Language"]) {
            const value = request.headers.get(header);
            if (value) forwardHeaders[header] = value;
        }
        await fetch(CLOUDFLARE_SEND_URL, { method: "POST", headers: forwardHeaders, body });
    } catch {
        // Silently fail — analytics should never break the user experience
    }
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
