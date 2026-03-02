import { useQuery } from "@tanstack/react-query";
import { fetchTVMazeByImdb, fetchTVMazeByTvdb, fetchTVMazeSchedule, type TVMazeShow } from "@/lib/tvmaze";
import type { TraktMediaItem } from "@/lib/trakt";

function tvmazeShowToTraktMediaItem(show: TVMazeShow): TraktMediaItem {
    return {
        show: {
            title: show.name || "Unknown",
            year: show.premiered ? parseInt(show.premiered.slice(0, 4), 10) || 0 : 0,
            ids: {
                trakt: 0,
                slug: show.externals?.imdb || `tvmaze-${show.id}`,
                tmdb: 0,
                imdb: show.externals?.imdb ?? undefined,
                tvdb: show.externals?.thetvdb ?? undefined,
            },
            images: {
                poster: show.image?.original ? [show.image.original] : show.image?.medium ? [show.image.medium] : [],
                fanart: [],
                logo: [],
                clearart: [],
                banner: [],
                thumb: [],
                headshot: [],
                screenshot: [],
            },
            overview: show.summary?.replace(/<[^>]+>/g, "") ?? undefined,
            rating: show.rating?.average ?? undefined,
            runtime: show.runtime ?? undefined,
            genres: show.genres,
            status: show.status?.toLowerCase(),
        },
    };
}

const CACHE_24H = 24 * 60 * 60 * 1000;

/**
 * Fetch TVMaze show details by IMDb ID (with TVDB fallback).
 * Returns network, schedule, official site, and other supplementary data
 * not available from Trakt.
 */
export function useTVMazeShow(imdbId?: string, tvdbId?: number) {
    return useQuery<TVMazeShow | null>({
        queryKey: ["tvmaze", "show", imdbId ?? tvdbId],
        queryFn: async () => {
            // Try IMDb first (most reliable)
            if (imdbId) {
                const show = await fetchTVMazeByImdb(imdbId);
                if (show) return show;
            }
            // Fallback to TVDB if available
            if (tvdbId) {
                return await fetchTVMazeByTvdb(tvdbId);
            }
            return null;
        },
        enabled: !!(imdbId || tvdbId),
        staleTime: CACHE_24H,
        gcTime: CACHE_24H * 2,
    });
}

const CACHE_1H = 60 * 60 * 1000;

/**
 * Fetch today's airing shows as TraktMediaItem[] for use in MediaSection.
 * Converts TVMaze schedule items into the standard TraktMediaItem shape.
 */
export function useTVMazeAiringToday(country = "US", enabled = true) {
    const today = new Date().toISOString().split("T")[0];
    return useQuery<TraktMediaItem[]>({
        queryKey: ["tvmaze", "airing-today", today, country],
        queryFn: async () => {
            const schedule = await fetchTVMazeSchedule(today, country);
            const seen = new Set<number>();
            const items: TraktMediaItem[] = [];
            for (const item of schedule) {
                if (seen.has(item.show.id) || !item.show.image) continue;
                // Skip shows without IMDb IDs — they'd create broken navigation links
                if (!item.show.externals?.imdb) continue;
                seen.add(item.show.id);
                items.push(tvmazeShowToTraktMediaItem(item.show));
                if (items.length >= 40) break;
            }
            return items;
        },
        enabled,
        staleTime: CACHE_1H,
        gcTime: CACHE_1H * 4,
    });
}
