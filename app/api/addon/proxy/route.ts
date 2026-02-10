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
 * Server-side proxy for Stremio addon requests.
 * Avoids CORS issues entirely since requests originate from the server.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    try {
        const response = await fetch(url, {
            headers: {
                accept: "application/json",
                "user-agent": "DebridUI",
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
                "cache-control": "public, max-age=300",
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: `Proxy error: ${error instanceof Error ? error.message : "Unknown error"}` },
            { status: 502 }
        );
    }
}
