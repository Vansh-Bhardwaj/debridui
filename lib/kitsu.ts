import type { TraktMedia } from "@/lib/trakt";

const KITSU_BASE = "https://kitsu.io/api/edge";

function safeISODate(dateStr: string): string | undefined {
    try {
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
    } catch {
        return undefined;
    }
}

interface KitsuAnimeAttributes {
    slug: string;
    synopsis?: string;
    titles: Record<string, string>;
    canonicalTitle: string;
    averageRating?: string;
    startDate?: string;
    endDate?: string;
    popularityRank?: number;
    ratingRank?: number;
    ageRating?: string;
    ageRatingGuide?: string;
    subtype?: string; // ONA, OVA, TV, movie, music, special
    status?: string; // current, finished, tba, unreleased, upcoming
    posterImage?: { large?: string; original?: string };
    coverImage?: { large?: string; original?: string };
    episodeCount?: number;
    episodeLength?: number;
    showType?: string;
}

interface KitsuResource {
    id: string;
    type: string;
    attributes: KitsuAnimeAttributes;
}

interface KitsuResponse {
    data: KitsuResource[] | KitsuResource;
}

/**
 * Search Kitsu for anime by title and return the best match.
 * Falls back to null on any error. No API key needed.
 */
export async function fetchKitsuByTitle(
    title: string,
): Promise<KitsuAnimeAttributes | null> {
    if (!title || title.length < 2) return null;

    const url = `${KITSU_BASE}/anime?filter[text]=${encodeURIComponent(title)}&page[limit]=1&fields[anime]=slug,synopsis,titles,canonicalTitle,averageRating,startDate,endDate,status,posterImage,coverImage,episodeCount,episodeLength,subtype,showType,ageRating`;

    try {
        const res = await fetch(url, {
            headers: {
                accept: "application/vnd.api+json",
                "content-type": "application/vnd.api+json",
            },
            signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return null;
        const data: KitsuResponse = await res.json();
        if (!data?.data) return null;
        const items = Array.isArray(data.data) ? data.data : [data.data];
        return items[0]?.attributes ?? null;
    } catch {
        return null;
    }
}

/**
 * Convert Kitsu anime attributes into a TraktMedia-shaped object
 * for seamless display in the existing UI.
 */
export function kitsuToTraktMedia(
    attrs: KitsuAnimeAttributes,
    type: "movie" | "show",
    imdbId?: string
): TraktMedia {
    const year = attrs.startDate ? parseInt(attrs.startDate.slice(0, 4), 10) || 0 : 0;
    // Kitsu averageRating is 0-100 scale → convert to 0-10
    const rating = attrs.averageRating ? parseFloat(attrs.averageRating) / 10 : undefined;
    const runtime = attrs.episodeLength ?? undefined;

    const statusMap: Record<string, string> = {
        current: "returning series",
        finished: "ended",
        tba: "planned",
        unreleased: "planned",
        upcoming: "planned",
    };

    return {
        title: attrs.canonicalTitle || attrs.titles?.en || Object.values(attrs.titles ?? {})[0] || "Unknown",
        year,
        ids: {
            trakt: 0,
            slug: imdbId || attrs.slug,
            tmdb: 0,
            imdb: imdbId,
        },
        images: {
            poster: attrs.posterImage?.large ? [attrs.posterImage.large] : [],
            fanart: attrs.coverImage?.large ? [attrs.coverImage.large] : [],
            logo: [],
            clearart: [],
            banner: [],
            thumb: [],
            headshot: [],
            screenshot: [],
        },
        overview: attrs.synopsis,
        rating,
        runtime,
        status: attrs.status ? statusMap[attrs.status] ?? attrs.status : undefined,
        certification: attrs.ageRating ?? undefined,
        first_aired: type === "show" && attrs.startDate ? safeISODate(attrs.startDate) : undefined,
        released: type === "movie" && attrs.startDate ? attrs.startDate : undefined,
        aired_episodes: attrs.episodeCount ?? undefined,
    };
}
