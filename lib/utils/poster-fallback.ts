import { fetchCinemetaMeta } from "@/lib/cinemeta";
import { useSettingsStore } from "@/lib/stores/settings";
import { createTMDBClient } from "@/lib/tmdb";

// Global cache for API-based poster lookups (persists across re-renders)
const posterApiCache = new Map<string, string | null>();
const posterApiInFlight = new Map<string, Promise<string | null>>();

/**
 * Try API-based poster sources as last resort. Results are globally cached.
 * Tries: Cinemeta (free) → TMDB (if user has API key configured).
 */
export async function fetchPosterFromAPIs(
    imdbId: string,
    type: "movie" | "show",
    triedUrls: string[]
): Promise<string | null> {
    if (posterApiCache.has(imdbId)) return posterApiCache.get(imdbId) ?? null;
    if (posterApiInFlight.has(imdbId)) return posterApiInFlight.get(imdbId)!;

    const promise = (async () => {
        // Try Cinemeta (free, no API key)
        try {
            const meta = await fetchCinemetaMeta(imdbId, type);
            if (meta?.poster && !triedUrls.includes(meta.poster)) {
                posterApiCache.set(imdbId, meta.poster);
                return meta.poster;
            }
        } catch { /* ignore */ }

        // Try TMDB (if user has API key configured)
        const tmdbKey = useSettingsStore.getState().settings.tmdbApiKey;
        if (tmdbKey) {
            try {
                const client = createTMDBClient(tmdbKey);
                if (client) {
                    const result = await client.findByExternalId(imdbId);
                    const posterPath =
                        result.movie_results[0]?.poster_path ??
                        result.tv_results[0]?.poster_path;
                    if (posterPath) {
                        const url = `https://image.tmdb.org/t/p/w300${posterPath}`;
                        posterApiCache.set(imdbId, url);
                        return url;
                    }
                }
            } catch { /* ignore */ }
        }

        posterApiCache.set(imdbId, null);
        return null;
    })();

    posterApiInFlight.set(imdbId, promise);
    try {
        return await promise;
    } finally {
        posterApiInFlight.delete(imdbId);
    }
}
