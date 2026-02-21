import { NextResponse } from "next/server";

const CLOUDFLARE_SEND_URL = "https://cloudflareinsights.com/cdn-cgi/rum";
const PROXY_SEND_PATH = "/api/analytics/send";

export async function GET() {
    const scriptUrl = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT;

    if (!scriptUrl?.startsWith("http")) {
        return new NextResponse(null, { status: 404 });
    }

    try {
        const response = await fetch(scriptUrl);
        if (!response.ok) {
            return new NextResponse(null, { status: response.status });
        }

        const script = await response.text();
        // Redirect beacon data through our proxy to avoid tracking prevention blocks
        const proxiedScript = script.replaceAll(CLOUDFLARE_SEND_URL, PROXY_SEND_PATH);

        return new NextResponse(proxiedScript, {
            headers: {
                "Content-Type": "application/javascript; charset=utf-8",
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            },
        });
    } catch {
        return new NextResponse(null, { status: 502 });
    }
}
