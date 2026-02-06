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
 * Subtitle proxy for VLC — returns raw subtitle content with a descriptive filename
 * in the URL path so VLC can detect the language and type.
 *
 * Usage: /api/subtitles/vlc/English.srt?url=<encoded_subtitle_url>
 */
export async function GET(req: Request, { params }: { params: Promise<{ filename: string }> }) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";
    const { filename } = await params;

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
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

    const text = await upstream.text();
    const isSrt = !text.trimStart().startsWith("WEBVTT");

    return new NextResponse(text, {
        status: 200,
        headers: {
            "content-type": isSrt ? "application/x-subrip; charset=utf-8" : "text/vtt; charset=utf-8",
            "content-disposition": `inline; filename="${filename}"`,
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
        },
    });
}
