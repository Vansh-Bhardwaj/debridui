/**
 * Client-side helpers for routing proxy traffic through the CORS proxy worker.
 *
 * - getSignedProxyUrl(kind, url): asks /api/sign for an HMAC-signed URL and
 *   caches it in-memory for ~55 minutes (server signs for 60). Subsequent calls
 *   for the same (kind, url) are free. Main worker CPU is spent once per
 *   resource, not once per fetch.
 * - getOGProxyUrl(url): no signing needed — /og on the proxy worker is
 *   origin-checked and edge-cached.
 */

import { CORS_PROXY_URL } from "./constants";

type SignKind = "addon" | "resolve";

interface SignedEntry {
    url: string;
    expiresAt: number;
}

const signCache = new Map<string, SignedEntry>();
const CACHE_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

export function getProxyWorkerBase(): string {
    try {
        return new URL(CORS_PROXY_URL).origin;
    } catch {
        return "";
    }
}

export async function getSignedProxyUrl(kind: SignKind, url: string): Promise<string> {
    const key = `${kind}:${url}`;
    const cached = signCache.get(key);
    if (cached && Date.now() < cached.expiresAt * 1000 - CACHE_SAFETY_MARGIN_MS) {
        return cached.url;
    }

    const res = await fetch(`/api/sign?kind=${kind}&url=${encodeURIComponent(url)}`, {
        credentials: "include",
    });
    if (!res.ok) {
        throw new Error(`Failed to sign proxy URL (${res.status})`);
    }
    const data = (await res.json()) as SignedEntry;

    signCache.set(key, data);
    if (signCache.size > MAX_CACHE_ENTRIES) {
        const oldest = signCache.keys().next().value;
        if (oldest) signCache.delete(oldest);
    }
    return data.url;
}

export function getOGProxyUrl(targetUrl: string): string {
    const base = getProxyWorkerBase();
    if (!base) return "";
    return `${base}/og?url=${encodeURIComponent(targetUrl)}`;
}
