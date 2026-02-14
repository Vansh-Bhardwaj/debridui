import { useSettingsStore } from "@/lib/stores/settings";
import { createTMDBClient, type TMDBCollectionDetails, type TMDBEpisodeGroupDetails, type TMDBEpisodeGroupsResponse } from "@/lib/tmdb";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

const CACHE_LONG = 24 * 60 * 60 * 1000; // 24 hours

export function useTMDBSeriesEpisodeGroups(seriesId: number): UseQueryResult<TMDBEpisodeGroupsResponse> {
    const apiKey = useSettingsStore((state) => state.get("tmdbApiKey"));

    return useQuery({
        queryKey: ["tmdb", "series", "episode-groups", seriesId],
        queryFn: async () => {
            const client = createTMDBClient(apiKey);
            if (!client) throw new Error("TMDB API key is not configured.");
            return client.getTVSeriesEpisodeGroups(seriesId);
        },
        staleTime: CACHE_LONG,
        enabled: !!apiKey && !!seriesId,
    });
}

export function useTMDBEpisodeGroupDetails(groupId: string): UseQueryResult<TMDBEpisodeGroupDetails> {
    const apiKey = useSettingsStore((state) => state.get("tmdbApiKey"));

    return useQuery({
        queryKey: ["tmdb", "episode-group", "details", groupId],
        queryFn: async () => {
            const client = createTMDBClient(apiKey);
            if (!client) throw new Error("TMDB API key is not configured.");
            return client.getEpisodeGroupDetails(groupId);
        },
        staleTime: CACHE_LONG,
        enabled: !!apiKey && !!groupId,
    });
}

/**
 * Fetches the movie collection (franchise) for a given TMDB movie ID.
 * First gets the movie details to find `belongs_to_collection`, then fetches the full collection.
 * Returns null if the movie doesn't belong to a collection.
 */
export function useTMDBMovieCollection(tmdbId: number | undefined): UseQueryResult<TMDBCollectionDetails | null> {
    const apiKey = useSettingsStore((state) => state.get("tmdbApiKey"));

    return useQuery({
        queryKey: ["tmdb", "movie", "collection", tmdbId],
        queryFn: async () => {
            const client = createTMDBClient(apiKey);
            if (!client) throw new Error("TMDB API key is not configured.");
            const movie = await client.getMovieDetails(tmdbId!);
            if (!movie.belongs_to_collection) return null;
            return client.getCollection(movie.belongs_to_collection.id);
        },
        staleTime: CACHE_LONG,
        enabled: !!apiKey && !!tmdbId,
    });
}
