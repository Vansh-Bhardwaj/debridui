import { useSettingsStore } from "@/lib/stores/settings";
import { createTMDBClient, type TMDBEpisodeGroupDetails, type TMDBEpisodeGroupsResponse } from "@/lib/tmdb";
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
