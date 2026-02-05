import { type TraktImages } from "@/lib/trakt";

// -- CDN proxy via wsrv.nl --

const CDN_BASE = "https://wsrv.nl/";

interface CdnOptions {
    w?: number;
    h?: number;
    q?: number;
    output?: "webp" | "avif" | "jpg" | "png";
    fit?: "contain" | "cover";
    n?: boolean;
    maxage?: string;
}

/**
 * Generate a CDN-proxied URL with WebP conversion, sizing, and caching.
 * Uses wsrv.nl as a free image proxy/CDN.
 */
export function cdnUrl(url: string, options?: CdnOptions): string {
    const params = new URLSearchParams();
    params.set("url", url);
    if (options?.w) params.set("w", String(options.w));
    if (options?.h) params.set("h", String(options.h));
    params.set("q", String(options?.q ?? 80));
    params.set("output", options?.output ?? "webp");
    if (options?.fit) params.set("fit", options.fit);
    if (options?.n) params.set("n", "");
    params.set("maxage", options?.maxage ?? "7d");
    return `${CDN_BASE}?${params}`;
}

// -- Image URL resolvers --

/**
 * Resolve image URLs that may be relative paths (Trakt/fanart.tv)
 * or full URLs (Stremio addons).
 */
export function resolveImageUrl(url: string): string {
    return url.startsWith("http") ? url : `https://${url}`;
}

export function getPosterUrl(images: TraktImages | undefined, fallback?: string): string | null {
    if (images?.poster?.[0]) return resolveImageUrl(images.poster[0]);
    if (images?.fanart?.[0]) return resolveImageUrl(images.fanart[0]);
    if (images?.banner?.[0]) return resolveImageUrl(images.banner[0]);
    return fallback || null;
}

export function getBackdropUrl(images: TraktImages | undefined): string | null {
    if (images?.fanart?.[0]) return resolveImageUrl(images.fanart[0]);
    if (images?.banner?.[0]) return resolveImageUrl(images.banner[0]);
    return null;
}
