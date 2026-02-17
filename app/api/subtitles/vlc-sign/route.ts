import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isBlockedUrl } from "@/lib/utils/url-safety";
import { getAppUrl, getEnv } from "@/lib/env";

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function sanitizeFilename(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "subtitle.srt";
}

async function signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * GET /api/subtitles/vlc-sign?url=...&label=English.srt
 * Returns a short-lived signed proxy URL that VLC can fetch without cookies.
 */
export async function GET(req: Request) {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";
    const label = sanitizeFilename(searchParams.get("label") ?? "English.srt");

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    if (isBlockedUrl(url)) {
        return NextResponse.json({ error: "Blocked destination" }, { status: 403 });
    }

    const secret = getEnv("NEON_AUTH_COOKIE_SECRET");
    if (!secret) {
        return NextResponse.json({ error: "Signing secret unavailable" }, { status: 500 });
    }

    const exp = Math.floor(Date.now() / 1000) + 10 * 60; // 10 minutes
    const payload = `${url}|${label}|${exp}`;
    const sig = await signPayload(payload, secret);

    const proxyUrl = `${getAppUrl()}/api/subtitles/vlc/${encodeURIComponent(label)}?url=${encodeURIComponent(url)}&exp=${exp}&sig=${sig}`;

    return NextResponse.json(
        { url: proxyUrl, expiresAt: exp },
        { headers: { "Cache-Control": "no-store" } }
    );
}
