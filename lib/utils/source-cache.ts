/**
 * Caches resolved stream URLs alongside progress data in localStorage.
 * Enables instant resume from the Continue Watching shelf by skipping
 * addon source search when a valid cached URL exists.
 *
 * TTL: 4 hours (debrid links typically expire in 4–24h).
 */

const SOURCE_CACHE_PREFIX = "source-cache:";
const SOURCE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CachedSource {
    url: string;
    title: string;
    cachedAt: number;
}

interface SourceCacheKey {
    imdbId: string;
    type: "movie" | "show";
    season?: number;
    episode?: number;
}

function getKey(k: SourceCacheKey): string {
    if (k.type === "show" && k.season !== undefined && k.episode !== undefined) {
        return `${SOURCE_CACHE_PREFIX}${k.imdbId}:s${k.season}e${k.episode}`;
    }
    return `${SOURCE_CACHE_PREFIX}${k.imdbId}`;
}

/** Store a resolved stream URL for quick resume. */
export function cacheSource(key: SourceCacheKey, url: string, title: string): void {
    if (typeof window === "undefined") return;
    try {
        const entry: CachedSource = { url, title, cachedAt: Date.now() };
        localStorage.setItem(getKey(key), JSON.stringify(entry));
    } catch {
        // Storage quota exceeded — ignore
    }
}

/** Retrieve a cached source if it's still within TTL. Returns null if expired or missing. */
export function getCachedSource(key: SourceCacheKey): CachedSource | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(getKey(key));
        if (!raw) return null;
        const entry: CachedSource = JSON.parse(raw);
        if (Date.now() - entry.cachedAt > SOURCE_CACHE_TTL_MS) {
            localStorage.removeItem(getKey(key));
            return null;
        }
        return entry;
    } catch {
        return null;
    }
}

/** Remove a cached source entry. */
export function clearCachedSource(key: SourceCacheKey): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.removeItem(getKey(key));
    } catch {
        // ignore
    }
}
