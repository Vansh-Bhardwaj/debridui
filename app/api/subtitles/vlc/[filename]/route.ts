import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isBlockedUrl } from "@/lib/utils/url-safety";
import { getEnv } from "@/lib/env";

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/** Decode raw bytes: try UTF-8 first, fall back to Windows-1252 */
function decodeSubtitleBytes(buf: ArrayBuffer): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
        return new TextDecoder("windows-1252").decode(buf);
    }
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

async function hasValidSignature(url: string, filename: string, expRaw: string | null, sigRaw: string | null): Promise<boolean> {
    if (!expRaw || !sigRaw) return false;

    const exp = parseInt(expRaw, 10);
    if (!exp || Number.isNaN(exp)) return false;
    if (Math.floor(Date.now() / 1000) > exp) return false;

    const secret = getEnv("NEON_AUTH_COOKIE_SECRET");
    if (!secret) return false;

    const payload = `${url}|${filename}|${exp}`;
    const expected = await signPayload(payload, secret);
    if (expected.length !== sigRaw.length) return false;

    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
        mismatch |= expected.charCodeAt(i) ^ sigRaw.charCodeAt(i);
    }
    return mismatch === 0;
}

/**
 * Subtitle proxy for VLC — returns raw subtitle content with a descriptive filename
 * in the URL path so VLC can detect the language and type.
 *
 * Usage: /api/subtitles/vlc/English.srt?url=<encoded_subtitle_url>
 */
export async function GET(req: Request, { params }: { params: Promise<{ filename: string }> }) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";
    const exp = searchParams.get("exp");
    const sig = searchParams.get("sig");
    const { filename } = await params;

    const signed = await hasValidSignature(url, filename, exp, sig);
    if (!signed) {
        const { data: session } = await auth.getSession();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    if (isBlockedUrl(url)) {
        return NextResponse.json({ error: "Blocked destination" }, { status: 403 });
    }

    const upstream = await fetch(url, {
        headers: {
            accept: "text/plain, text/vtt, application/x-subrip, */*",
            "user-agent": "DebridUI",
        },
        redirect: "follow",
    });

    if (!upstream.ok) {
        return NextResponse.json(
            { error: `Upstream error: ${upstream.status} ${upstream.statusText}` },
            { status: upstream.status },
        );
    }

    const buf = await upstream.arrayBuffer();
    const text = decodeSubtitleBytes(buf);
    const isSrt = !text.trimStart().startsWith("WEBVTT");

    return new NextResponse(text, {
        status: 200,
        headers: {
            "content-type": isSrt ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
            "content-disposition": `inline; filename="${filename}"`,
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=3600, stale-while-revalidate=1800",
        },
    });
}
