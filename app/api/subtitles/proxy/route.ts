import { NextResponse } from "next/server";

function isSafeHttpUrl(value: string): boolean {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

function srtToVtt(srt: string): string {
    // Minimal SRT -> WebVTT conversion (good enough for most addon SRTs).
    // Browsers are far more consistent with VTT than SRT in <track>.
    const lines = srt.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const out: string[] = ["WEBVTT", ""];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Drop numeric cue indexes
        if (/^\d+$/.test(line.trim())) continue;

        // Convert timing line commas to dots: 00:00:01,000 --> 00:00:02,000
        if (line.includes("-->")) {
            out.push(line.replaceAll(",", "."));
            continue;
        }

        out.push(line);
    }

    return out.join("\n");
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url") ?? "";
    // raw=1 skips VTT conversion (for external players like VLC that prefer SRT)
    const raw = searchParams.get("raw") === "1";
    const lang = searchParams.get("lang") ?? "";

    if (!url || !isSafeHttpUrl(url)) {
        return NextResponse.json({ error: "Invalid url" }, { status: 400 });
    }

    // Fetch subtitle file server-side and stream it back with permissive headers.
    // We intentionally do not forward cookies/credentials.
    const upstream = await fetch(url, {
        headers: {
            // Many subtitle hosts behave better when we set an explicit UA + accept.
            accept: "text/plain, text/vtt, application/x-subrip, */*",
            "user-agent": "DebridUI",
        },
        redirect: "follow",
    });

    if (!upstream.ok) {
        return NextResponse.json(
            { error: `Upstream error: ${upstream.status} ${upstream.statusText}` },
            { status: upstream.status }
        );
    }

    // Raw mode: return upstream content as-is (for VLC and other external players)
    if (raw) {
        const text = await upstream.text();
        const ext = text.trimStart().startsWith("WEBVTT") ? "vtt" : "srt";
        const filename = lang ? `${lang}.${ext}` : `subtitle.${ext}`;
        return new NextResponse(text, {
            status: 200,
            headers: {
                "content-type": ext === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8",
                "content-disposition": `inline; filename="${filename}"`,
                "access-control-allow-origin": "*",
                "cache-control": "public, max-age=300",
                ...(lang ? { "content-language": lang } : {}),
            },
        });
    }

    const upstreamContentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
    const isVtt = upstreamContentType.includes("text/vtt");
    const isSrt =
        upstreamContentType.includes("application/x-subrip") ||
        upstreamContentType.includes("application/octet-stream") ||
        upstreamContentType.includes("text/plain");

    // Always return VTT to maximize browser compatibility with <track>.
    if (isVtt) {
        return new NextResponse(upstream.body, {
            status: 200,
            headers: {
                "content-type": "text/vtt; charset=utf-8",
                "access-control-allow-origin": "*",
                "cache-control": "public, max-age=300",
            },
        });
    }

    // For SRT-ish responses, convert to VTT.
    if (isSrt) {
        const text = await upstream.text();
        const vtt = text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text);
        return new NextResponse(vtt, {
            status: 200,
            headers: {
                "content-type": "text/vtt; charset=utf-8",
                "access-control-allow-origin": "*",
                "cache-control": "public, max-age=300",
            },
        });
    }

    // Unknown type: pass through as text, but still label VTT if it looks like it.
    const text = await upstream.text();
    const asVtt = text.trimStart().startsWith("WEBVTT") ? text : srtToVtt(text);
    return new NextResponse(asVtt, {
        status: 200,
        headers: {
            "content-type": "text/vtt; charset=utf-8",
            "access-control-allow-origin": "*",
            "cache-control": "public, max-age=300",
        },
    });
}

