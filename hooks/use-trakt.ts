import { keepPreviousData, useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
import { traktClient, TraktError, type TraktMedia, type TraktMediaItem } from "@/lib/trakt";
import { useUserSettings } from "./use-user-settings";
import { useSettingsStore } from "@/lib/stores/settings";
import { createTMDBClient, tmdbToTraktMedia } from "@/lib/tmdb";
import { fetchCinemetaMeta, cinemetaToTraktMedia } from "@/lib/cinemeta";
import { fetchKitsuByTitle, kitsuToTraktMedia } from "@/lib/kitsu";
import { toast } from "sonner";

// Cache duration constants
const CACHE_DURATION = {
    SHORT: 5 * 60 * 1000, // 5 minutes
    STANDARD: 6 * 60 * 60 * 1000, // 6 hours
    LONG: 24 * 60 * 60 * 1000, // 24 hours
    INSTANT: 30 * 1000, // 30s — always refetch on mount, but avoid hammering during session
} as const;

// Generic Trakt query hook factory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTraktHook<T extends any[], R>(
    keyParts: string[],
    fn: (...args: T) => Promise<R>,
    cacheDuration: number,
    options?: { keepPrevious?: boolean }
) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (...rawArgs: any[]): UseQueryResult<R> => {
        // Convention: trailing boolean arg = `enabled` flag (not passed to queryFn)
        const last = rawArgs[rawArgs.length - 1];
        const hasEnabled = rawArgs.length > 0 && typeof last === "boolean";
        const enabled = hasEnabled ? (last as boolean) : true;
        const args = (hasEnabled ? rawArgs.slice(0, -1) : rawArgs) as unknown as T;

        return useQuery({
            queryKey: ["trakt", ...keyParts, ...args],
            queryFn: () => fn(...args),
            enabled,
            placeholderData: options?.keepPrevious ? keepPreviousData : undefined,
            staleTime: cacheDuration,
            gcTime: cacheDuration * 2,
        });
    };
}

// List hooks - significantly reduced code
export const useTraktTrendingMovies = createTraktHook(
    ["movies", "trending"],
    (limit = 20) => traktClient.getTrendingMovies(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktTrendingShows = createTraktHook(
    ["shows", "trending"],
    (limit = 20) => traktClient.getTrendingShows(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktPopularMovies = createTraktHook(
    ["movies", "popular"],
    (limit = 20) => traktClient.getPopularMovies(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktPopularShows = createTraktHook(
    ["shows", "popular"],
    (limit = 20) => traktClient.getPopularShows(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktMostWatchedMovies = createTraktHook(
    ["movies", "watched"],
    (period = "weekly", limit = 20) => traktClient.getMostWatchedMovies(period, limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktMostWatchedShows = createTraktHook(
    ["shows", "watched"],
    (period = "weekly", limit = 20) => traktClient.getMostWatchedShows(period, limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktAnticipatedMovies = createTraktHook(
    ["movies", "anticipated"],
    (limit = 20) => traktClient.getAnticipatedMovies(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktAnticipatedShows = createTraktHook(
    ["shows", "anticipated"],
    (limit = 20) => traktClient.getAnticipatedShows(limit),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

export const useTraktBoxOfficeMovies = createTraktHook(
    ["movies", "boxoffice"],
    () => traktClient.getBoxOfficeMovies(),
    CACHE_DURATION.STANDARD,
    { keepPrevious: true }
);

// Details hooks
export const useTraktMovieDetails = createTraktHook(
    ["movie"],
    (slug: string) => traktClient.getMovie(slug),
    CACHE_DURATION.LONG
);

export const useTraktShowDetails = createTraktHook(
    ["show"],
    (slug: string) => traktClient.getShow(slug),
    CACHE_DURATION.LONG
);

export const useTraktShowSeasons = createTraktHook(
    ["show", "seasons"],
    (slug: string) => traktClient.getShowSeasons(slug),
    CACHE_DURATION.LONG
);

export const useTraktSeasonEpisodes = createTraktHook(
    ["season", "episodes"],
    (slug: string, season: number) => traktClient.getShowEpisodes(slug, season),
    CACHE_DURATION.LONG
);

// Aliases for backward compatibility
export const useTraktMostPlayedMovies = useTraktMostWatchedMovies;
export const useTraktMostPlayedShows = useTraktMostWatchedShows;

// Combined hooks
export function useTraktTrendingMixed(limit = 20) {
    return useQuery({
        queryKey: ["trakt", "mixed", "trending", limit],
        queryFn: () => traktClient.getTrendingMixed(limit),
        staleTime: CACHE_DURATION.STANDARD,
        gcTime: CACHE_DURATION.STANDARD * 2,
    });
}

export function useTraktRecommendations(enabled = true) {
    return useQuery({
        queryKey: ["trakt", "recommendations"],
        queryFn: async () => {
            const [movies, shows] = await Promise.all([
                traktClient.getRecommendations("movies", 5),
                traktClient.getRecommendations("shows", 5),
            ]);
            // Interleave movies and shows for variety
            const mixed: TraktMediaItem[] = [];
            const max = Math.max(movies.length, shows.length);
            for (let i = 0; i < max; i++) {
                if (movies[i]) mixed.push(movies[i]);
                if (shows[i]) mixed.push(shows[i]);
            }
            const items = mixed;
            // Fall back to trending if no recommendations yet (insufficient watch history)
            if (items.length === 0) {
                const trending = await traktClient.getTrendingMixed(8);
                return { items: trending.mixed, isPersonalized: false };
            }
            return { items, isPersonalized: true };
        },
        enabled,
        staleTime: CACHE_DURATION.STANDARD,
        gcTime: CACHE_DURATION.LONG,
    });
}

export function useTraktMedia(slug: string, type: "movie" | "show") {
    const tmdbApiKey = useSettingsStore((s) => s.get("tmdbApiKey"));

    return useQuery({
        queryKey: ["trakt", "media", slug, type, { tmdbFallback: !!tmdbApiKey }],
        queryFn: async () => {
            try {
                return await (type === "movie" ? traktClient.getMovie(slug) : traktClient.getShow(slug));
            } catch (error) {
                const is404 = error instanceof TraktError && error.status === 404;
                const isImdbId = slug.startsWith("tt");

                if (is404 && isImdbId) {
                    // Try TMDB first if the user has an API key configured
                    if (tmdbApiKey) {
                        try {
                            const client = createTMDBClient(tmdbApiKey);
                            if (client) {
                                const detail = await client.findByImdbId(slug, type);
                                if (detail) return tmdbToTraktMedia(detail, type, slug);
                            }
                        } catch {
                            // TMDB failed (network error, etc.) — fall through to Cinemeta
                        }
                    }

                    // Always try Cinemeta as next fallback (free, no key needed)
                    const meta = await fetchCinemetaMeta(slug, type);
                    if (meta) return cinemetaToTraktMedia(meta, type);

                    // Try Kitsu as anime-specific fallback (free, no key needed)
                    // Only useful with readable slugs — IMDb IDs can't be title-searched
                    if (!isImdbId) {
                        try {
                            const kitsu = await fetchKitsuByTitle(slug.replace(/-/g, " "));
                            if (kitsu) return kitsuToTraktMedia(kitsu, type, slug);
                        } catch {
                            // Kitsu failed — continue to throw
                        }
                    }
                }

                throw error;
            }
        },
        staleTime: CACHE_DURATION.LONG,
        gcTime: CACHE_DURATION.LONG,
    });
}

export const useTraktShowEpisodes = useTraktSeasonEpisodes;

export function useTraktPeople(id: string, type: "movies" | "shows" = "movies") {
    return useQuery({
        queryKey: ["trakt", "people", id, type],
        queryFn: () => traktClient.getPeople(id, type),
        staleTime: CACHE_DURATION.LONG,
        gcTime: CACHE_DURATION.LONG,
    });
}

export const useTraktPerson = createTraktHook(
    ["person"],
    (slug: string) => traktClient.getPerson(slug),
    CACHE_DURATION.LONG
);

export const useTraktPersonMovies = createTraktHook(
    ["person", "movies"],
    (slug: string) => traktClient.getPersonMovies(slug),
    CACHE_DURATION.LONG
);

export const useTraktPersonShows = createTraktHook(
    ["person", "shows"],
    (slug: string) => traktClient.getPersonShows(slug),
    CACHE_DURATION.LONG
);

// Watchlist hooks (require auth — only enabled when access token is set)
export function useTraktWatchlistMovies() {
    return useQuery({
        queryKey: ["trakt", "watchlist", "movies"],
        queryFn: () => traktClient.getWatchlist("movies", "added"),
        placeholderData: keepPreviousData,
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useTraktWatchlistShows() {
    return useQuery({
        queryKey: ["trakt", "watchlist", "shows"],
        queryFn: () => traktClient.getWatchlist("shows", "added"),
        placeholderData: keepPreviousData,
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useRemoveFromWatchlist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.removeFromWatchlist({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
        },
    });
}

export function useAddToWatchlist() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.addToWatchlist({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
        },
    });
}

// Favorites hooks
export function useTraktFavoritesMovies() {
    return useQuery({
        queryKey: ["trakt", "favorites", "movies"],
        queryFn: () => traktClient.getFavorites("movies"),
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useTraktFavoritesShows() {
    return useQuery({
        queryKey: ["trakt", "favorites", "shows"],
        queryFn: () => traktClient.getFavorites("shows"),
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useAddToFavorites() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.addToFavorites({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "favorites"] });
        },
    });
}

export function useRemoveFromFavorites() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.removeFromFavorites({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "favorites"] });
        },
    });
}

// Ratings hooks
export function useTraktRatingsMovies() {
    return useQuery({
        queryKey: ["trakt", "ratings", "movies"],
        queryFn: () => traktClient.getRatings("movies"),
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useTraktRatingsShows() {
    return useQuery({
        queryKey: ["trakt", "ratings", "shows"],
        queryFn: () => traktClient.getRatings("shows"),
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
        refetchOnWindowFocus: false,
    });
}

export function useAddRating() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number; rating: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.addRatings({ [key]: [{ ids, rating: params.rating }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "ratings"] });
        },
    });
}

export function useRemoveRating() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.removeRatings({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "ratings"] });
        },
    });
}

// History hooks
export function useAddToHistory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movies" : "shows";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.addToHistory({ [key]: [{ ids }] });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
        },
    });
}

/** Mark individual episode(s) as watched */
export function useMarkEpisodeWatched() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { showTraktId: number; showId: string; season: number; episodes: number[] }) =>
            traktClient.addEpisodesToHistory(
                { trakt: params.showTraktId },
                params.season,
                params.episodes
            ),
        onMutate: async (params) => {
            // Optimistic update: mark episodes as watched immediately
            await queryClient.cancelQueries({ queryKey: ["trakt", "show", "progress", params.showId] });
            const prev = queryClient.getQueryData(["trakt", "show", "progress", params.showId]);
            queryClient.setQueryData(["trakt", "show", "progress", params.showId], (old: Record<string, unknown> | undefined) => {
                if (!old || !Array.isArray((old as { seasons?: unknown[] }).seasons)) return old;
                const seasons = (old as { seasons: { number: number; episodes: { number: number; completed: boolean }[] }[] }).seasons.map((s) => {
                    if (s.number !== params.season) return s;
                    return {
                        ...s,
                        episodes: s.episodes.map((ep) =>
                            params.episodes.includes(ep.number) ? { ...ep, completed: true } : ep
                        ),
                    };
                });
                return { ...old, seasons };
            });
            return { prev };
        },
        onError: (_err, params, ctx) => {
            if (ctx?.prev) queryClient.setQueryData(["trakt", "show", "progress", params.showId], ctx.prev);
            toast.error("Failed to mark as watched", { description: "Check your Trakt connection in Settings" });
        },
        onSuccess: async (_data, params) => {
            toast.success(
                params.episodes.length === 1
                    ? `S${params.season}E${params.episodes[0]} marked as watched`
                    : `${params.episodes.length} episodes marked as watched`
            );

            // Trakt auto-removes shows from watchlist when episodes are added to history.
            // Re-add the show to the watchlist to counteract this side-effect.
            try {
                await traktClient.addToWatchlist({ shows: [{ ids: { trakt: params.showTraktId } }] });
            } catch {
                // Silently ignore — watchlist restoration is best-effort
            }

            // Delay invalidation slightly — Trakt needs a moment to process
            // The optimistic update already shows the correct state instantly
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress", params.showId] });
                queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
            }, 2000);
        },
        onSettled: () => {
            // noop — invalidation moved to onSuccess with delay
        },
    });
}

/** Unmark individual episode(s) as watched */
export function useUnmarkEpisodeWatched() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (params: { showTraktId: number; showId: string; season: number; episodes: number[] }) =>
            traktClient.removeEpisodesFromHistory(
                { trakt: params.showTraktId },
                params.season,
                params.episodes
            ),
        onMutate: async (params) => {
            await queryClient.cancelQueries({ queryKey: ["trakt", "show", "progress", params.showId] });
            const prev = queryClient.getQueryData(["trakt", "show", "progress", params.showId]);
            queryClient.setQueryData(["trakt", "show", "progress", params.showId], (old: Record<string, unknown> | undefined) => {
                if (!old || !Array.isArray((old as { seasons?: unknown[] }).seasons)) return old;
                const seasons = (old as { seasons: { number: number; episodes: { number: number; completed: boolean }[] }[] }).seasons.map((s) => {
                    if (s.number !== params.season) return s;
                    return {
                        ...s,
                        episodes: s.episodes.map((ep) =>
                            params.episodes.includes(ep.number) ? { ...ep, completed: false } : ep
                        ),
                    };
                });
                return { ...old, seasons };
            });
            return { prev };
        },
        onError: (_err, params, ctx) => {
            if (ctx?.prev) queryClient.setQueryData(["trakt", "show", "progress", params.showId], ctx.prev);
            toast.error("Failed to unmark watched", { description: "Check your Trakt connection in Settings" });
        },
        onSuccess: (_data, params) => {
            toast.success(
                params.episodes.length === 1
                    ? `S${params.season}E${params.episodes[0]} unmarked`
                    : `${params.episodes.length} episodes unmarked`
            );
            setTimeout(() => {
                queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress", params.showId] });
            }, 2000);
        },
        onSettled: () => {
            // noop — invalidation moved to onSuccess with delay
        },
    });
}

// Checkin hooks
export function useCheckin() {
    return useMutation({
        mutationFn: (params: { type: "movie" | "show"; imdbId?: string; traktId?: number }) => {
            const key = params.type === "movie" ? "movie" : "episode";
            const ids: { imdb?: string; trakt?: number } = {};
            if (params.imdbId) ids.imdb = params.imdbId;
            if (params.traktId) ids.trakt = params.traktId;
            return traktClient.checkin({ [key]: { ids } });
        },
    });
}

// Related content hooks
export function useTraktRelated(id: string, type: "movie" | "show") {
    return useQuery<TraktMedia[]>({
        queryKey: ["trakt", "related", type, id],
        queryFn: () => (type === "movie" ? traktClient.getRelatedMovies(id) : traktClient.getRelatedShows(id)),
        staleTime: CACHE_DURATION.LONG,
        gcTime: CACHE_DURATION.LONG,
        enabled: !!id,
    });
}

// Watched progress hooks (require auth)
export function useTraktShowProgress(showId: string) {
    const { data: settings } = useUserSettings(true);
    const hasAuth = !!settings?.trakt_access_token;
    return useQuery({
        queryKey: ["trakt", "show", "progress", showId],
        queryFn: () => traktClient.getShowWatchedProgress(showId),
        staleTime: CACHE_DURATION.INSTANT, // Refetch on every page visit — watched status must feel instant
        gcTime: CACHE_DURATION.STANDARD,   // Keep in cache for reuse but always revalidate
        enabled: !!showId && hasAuth,
        retry: 1,
    });
}

// Calendar hooks (require auth)
export function useTraktCalendarShows(days = 14) {
    return useQuery({
        queryKey: ["trakt", "calendar", "shows", days],
        queryFn: () => traktClient.getCalendarShows(undefined, days),
        placeholderData: keepPreviousData,
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
    });
}

export function useTraktCalendarMovies(days = 30) {
    return useQuery({
        queryKey: ["trakt", "calendar", "movies", days],
        queryFn: () => traktClient.getCalendarMovies(undefined, days),
        placeholderData: keepPreviousData,
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
    });
}

/** Recently aired episodes from shows the user watches (past N days) */
export function useTraktRecentEpisodes(days = 7) {
    return useQuery({
        queryKey: ["trakt", "calendar", "recent-episodes", days],
        queryFn: () => {
            const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
            return traktClient.getCalendarShows(startDate, days);
        },
        placeholderData: keepPreviousData,
        staleTime: CACHE_DURATION.SHORT,
        gcTime: CACHE_DURATION.SHORT * 2,
        enabled: !!traktClient.getAccessToken(),
    });
}

/** Lookup a movie by TMDB ID — returns the Trakt slug for linking */
export function useTraktSlugFromTmdb(tmdbId: number | undefined) {
    return useQuery({
        queryKey: ["trakt", "lookup", "tmdb", tmdbId],
        queryFn: async () => {
            const results = await traktClient.lookupByExternalId("tmdb", tmdbId!);
            const movie = results[0]?.movie;
            return movie?.ids?.slug ?? null;
        },
        staleTime: CACHE_DURATION.LONG,
        gcTime: CACHE_DURATION.LONG,
        enabled: !!tmdbId,
    });
}
