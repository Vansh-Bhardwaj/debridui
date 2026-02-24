import type { TraktMedia } from "@/lib/trakt";

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

interface CinemetaMeta {
    id: string;
    imdb_id?: string;
    type: string;
    name: string;
    slug?: string;
    year?: string;
    description?: string;
    runtime?: string;
    genres?: string[];
    poster?: string;
    background?: string;
    logo?: string;
    imdbRating?: string;
    status?: string;
    released?: string;
    language?: string;
    country?: string;
    website?: string;
    trailers?: { source: string; type: string }[];
}

interface CinemetaResponse {
    meta?: CinemetaMeta;
}

/**
 * Fetch metadata from Cinemeta (free Stremio addon, no API key required).
 * Returns null if not found or on error.
 */
export async function fetchCinemetaMeta(
    imdbId: string,
    type: "movie" | "show"
): Promise<CinemetaMeta | null> {
    const cinemetaType = type === "show" ? "series" : "movie";
    const url = `${CINEMETA_BASE}/meta/${cinemetaType}/${encodeURIComponent(imdbId)}.json`;

    try {
        const res = await fetch(url, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const data: CinemetaResponse = await res.json();
        return data.meta ?? null;
    } catch {
        return null;
    }
}

/** Convert Cinemeta metadata into a TraktMedia-shaped object for seamless fallback display. */
export function cinemetaToTraktMedia(meta: CinemetaMeta, type: "movie" | "show"): TraktMedia {
    const year = meta.year ? parseInt(meta.year, 10) || 0 : 0;
    const rating = meta.imdbRating ? parseFloat(meta.imdbRating) || undefined : undefined;
    const runtime = meta.runtime ? parseInt(meta.runtime, 10) || undefined : undefined;
    const imdbId = meta.imdb_id || meta.id;

    // Use Cinemeta poster, fallback to RPDB if missing
    const posterUrl = meta.poster
        || (imdbId.startsWith("tt") ? `https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/${imdbId}.jpg` : undefined);

    return {
        title: meta.name,
        year,
        ids: {
            trakt: 0,
            slug: imdbId,
            tmdb: 0,
            imdb: imdbId,
        },
        images: {
            poster: posterUrl ? [posterUrl] : [],
            fanart: meta.background ? [meta.background] : [],
            logo: meta.logo ? [meta.logo] : [],
            clearart: [],
            banner: [],
            thumb: [],
            headshot: [],
            screenshot: [],
        },
        overview: meta.description,
        rating,
        runtime,
        genres: meta.genres?.map((g) => g.toLowerCase()),
        language: meta.language,
        country: meta.country,
        homepage: meta.website,
        status: meta.status,
        released: type === "movie" ? meta.released : undefined,
        first_aired: type === "show" && meta.released ? new Date(meta.released).toISOString() : undefined,
    };
}
