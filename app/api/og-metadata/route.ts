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

interface OGMetadata {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    favicon: string | null;
}

function extractMetaContent(html: string, property: string): string | null {
    // Match both property="og:..." and name="og:..."
    // Using {0,500} instead of * to prevent ReDoS on crafted input
    const regex = new RegExp(
        `<meta[^>]{0,500}(?:property|name)=["']${property}["'][^>]{0,500}content=["']([^"']{0,2000})["']|<meta[^>]{0,500}content=["']([^"']{0,2000})["'][^>]{0,500}(?:property|name)=["']${property}["']`,
        "i"
    );
    const match = html.match(regex);
    return match?.[1] ?? match?.[2] ?? null;
}

function extractTitle(html: string): string | null {
    const match = html.match(/<title[^>]{0,200}>([^<]{0,500})<\/title>/i);
    const raw = match?.[1]?.trim() || null;
    if (!raw) return null;
    // Decode common HTML entities
    return raw
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractFavicon(html: string, baseUrl: string): string | null {
    // Look for <link rel="icon" or rel="shortcut icon"
    const match = html.match(/<link[^>]{0,500}rel=["'](?:shortcut )?icon["'][^>]{0,500}href=["']([^"']{1,500})["']/i)
        ?? html.match(/<link[^>]{0,500}href=["']([^"']{1,500})["'][^>]{0,500}rel=["'](?:shortcut )?icon["']/i);

    if (match?.[1]) {
        try {
            return new URL(match[1], baseUrl).href;
        } catch {
            return null;
        }
    }

    // Default to /favicon.ico
    try {
        const url = new URL(baseUrl);
        return `${url.origin}/favicon.ico`;
    } catch {
        return null;
    }
}

function resolveUrl(relative: string | null, base: string): string | null {
    if (!relative) return null;
    try {
        return new URL(relative, base).href;
    } catch {
        return null;
    }
}

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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch(url, {
                headers: {
                    accept: "text/html, */*",
                    "user-agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                },
                redirect: "follow",
                signal: controller.signal,
            });

            if (!response.ok) {
                return NextResponse.json({ error: "Fetch failed" }, { status: 502 });
            }

            // Only parse HTML responses, limit to 128KB to avoid large payloads
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.includes("text/html")) {
                return NextResponse.json({ error: "Not HTML" }, { status: 422 });
            }

            const reader = response.body?.getReader();
            if (!reader) {
                return NextResponse.json({ error: "No body" }, { status: 502 });
            }

            const chunks: Uint8Array[] = [];
            let totalSize = 0;
            const maxSize = 128 * 1024; // 128KB

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                totalSize += value.length;
                // OG tags live in <head> — stop once we pass it to save CPU + memory
                if (totalSize > 4096) {
                    const partial = new TextDecoder().decode(value);
                    if (partial.includes("</head")) break;
                }
                if (totalSize >= maxSize) break;
            }
            reader.cancel().catch(() => {});

            const html = new TextDecoder().decode(
                chunks.length === 1 ? chunks[0] : mergeChunks(chunks, totalSize)
            );

            const metadata: OGMetadata = {
                title: extractMetaContent(html, "og:title") ?? extractTitle(html),
                description: extractMetaContent(html, "og:description"),
                image: resolveUrl(extractMetaContent(html, "og:image"), url),
                siteName: extractMetaContent(html, "og:site_name"),
                favicon: extractFavicon(html, url),
            };

            return NextResponse.json(metadata, {
                headers: { "cache-control": "public, max-age=86400, s-maxage=86400" },
            });
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });
    }
}

function mergeChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
    }
    return merged;
}
