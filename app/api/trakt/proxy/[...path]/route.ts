import { NextRequest, NextResponse } from "next/server";
import { CORS_PROXY_URL } from "@/lib/constants";

const UPSTREAM = "https://api.trakt.tv";

/** Trakt sits behind Cloudflare; Worker/datacenter fetches often get 403 — match token refresh + addon proxy behavior. */
const UPSTREAM_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const dynamic = "force-dynamic";

function upstreamUrl(req: NextRequest, segments: string[]): string | null {
    if (segments.some((s) => s.includes(".."))) return null;
    const path = segments.join("/");
    const u = new URL(req.url);
    return `${UPSTREAM}/${path}${u.search}`;
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
    const target = upstreamUrl(req, segments);
    if (!target) {
        return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: "Trakt client ID not configured" }, { status: 500 });
    }

    const method = req.method;
    const headers = new Headers();
    headers.set("trakt-api-version", req.headers.get("trakt-api-version") ?? "2");
    headers.set("trakt-api-key", clientId);
    headers.set("User-Agent", UPSTREAM_UA);

    const auth = req.headers.get("authorization");
    if (auth) headers.set("Authorization", auth);

    const accept = req.headers.get("accept");
    if (accept) headers.set("Accept", accept);

    const ct = req.headers.get("content-type");
    if (ct && method !== "GET" && method !== "HEAD") {
        headers.set("Content-Type", ct);
    }

    let body: ArrayBuffer | undefined;
    if (method !== "GET" && method !== "HEAD") {
        const buf = await req.arrayBuffer();
        if (buf.byteLength > 0) body = buf;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
        const init: RequestInit = {
            method,
            headers,
            body,
            redirect: "follow",
            signal: controller.signal,
        };

        let res = await fetch(target, init);

        // Same pattern as TraktClient.exchangeCode / refreshToken: direct Worker→Trakt can be WAF-blocked.
        if (res.status === 403) {
            res.body?.cancel();
            const proxyBase = process.env.NEXT_PUBLIC_CORS_PROXY_URL || CORS_PROXY_URL;
            try {
                res = await fetch(`${proxyBase}${encodeURIComponent(target)}`, init);
            } catch (fallbackErr) {
                console.error("[trakt/proxy] CORS proxy fallback failed", fallbackErr);
                return NextResponse.json({ error: "Trakt upstream blocked (403)" }, { status: 502 });
            }
        }

        const outHeaders = new Headers();
        const upstreamCt = res.headers.get("content-type");
        if (upstreamCt) outHeaders.set("content-type", upstreamCt);
        outHeaders.set("cache-control", "private, no-store");

        return new NextResponse(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: outHeaders,
        });
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
        }
        console.error("[trakt/proxy]", e);
        return NextResponse.json({ error: "Proxy request failed" }, { status: 502 });
    } finally {
        clearTimeout(timeout);
    }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}

export async function HEAD(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
    const { path } = await ctx.params;
    return proxy(req, path);
}
