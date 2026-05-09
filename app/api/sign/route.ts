import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { isBlockedUrl } from "@/lib/utils/url-safety";
import { CORS_PROXY_URL } from "@/lib/constants";

/**
 * Signs a target URL so it can be fetched by the proxy worker without requiring
 * auth on every hit. The actual fetch happens entirely on the proxy worker
 * (separate 10ms CPU budget), so the main worker only pays the cost of one
 * session check + one HMAC sign per resource.
 *
 * GET /api/sign?kind=addon|resolve&url=<target>
 * → { url: "<proxy-worker>/addon?url=&exp=&sig=", expiresAt: unix_seconds }
 */

const SIGN_TTL_SECONDS = 60 * 60; // 1 hour — long enough for a watch session, short enough to bound misuse

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function getProxyWorkerBase(): string | null {
    // CORS_PROXY_URL is stored as "<origin>/?url=" — strip the query part to
    // get the bare origin we can append /addon, /resolve, /og to.
    const raw = CORS_PROXY_URL || getEnv("NEXT_PUBLIC_CORS_PROXY_URL");
    if (!raw) return null;
    try {
        const u = new URL(raw);
        return `${u.origin}`;
    } catch {
        return null;
    }
}

async function signPayload(payload: string, secret: string): Promise<string> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
    return Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

export async function GET(req: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kind = searchParams.get("kind");
    const url = searchParams.get("url") ?? "";

    if (kind !== "addon" && kind !== "resolve") {
        return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }
    if (isBlockedUrl(url)) {
        return NextResponse.json({ error: "Blocked destination" }, { status: 403 });
    }

    const secret = getEnv("SIGNING_SECRET");
    if (!secret) {
        return NextResponse.json({ error: "SIGNING_SECRET not configured" }, { status: 500 });
    }

    const base = getProxyWorkerBase();
    if (!base) {
        return NextResponse.json({ error: "Proxy worker URL not configured" }, { status: 500 });
    }

    const exp = Math.floor(Date.now() / 1000) + SIGN_TTL_SECONDS;
    const sig = await signPayload(`${kind}|${url}|${exp}`, secret);
    const signedUrl = `${base}/${kind}?url=${encodeURIComponent(url)}&exp=${exp}&sig=${sig}`;

    return NextResponse.json(
        { url: signedUrl, expiresAt: exp },
        { headers: { "Cache-Control": "private, max-age=60" } },
    );
}
