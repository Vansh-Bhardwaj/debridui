import { useQuery, useMutation, useQueryClient, UseQueryResult } from "@tanstack/react-query";
import { traktClient, type TraktMedia } from "@/lib/trakt";

// Cache duration constants
const CACHE_DURATION = {
    SHORT: 5 * 60 * 1000, // 5 minutes
    STANDARD: 6 * 60 * 60 * 1000, // 6 hours
    LONG: 24 * 60 * 60 * 1000, // 24 hours
} as const;

// Generic Trakt query hook factory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTraktHook<T extends any[], R>(
    keyParts: string[],
    fn: (...args: T) => Promise<R>,
    cacheDuration: number
) {
    return (...args: T): UseQueryResult<R> => {
        return useQuery({
            queryKey: ["trakt", ...keyParts, ...args],
            queryFn: () => fn(...args),
            staleTime: cacheDuration,
        });
    };
}

// List hooks - significantly reduced code
export const useTraktTrendingMovies = createTraktHook(
    ["movies", "trending"],
    (limit = 20) => traktClient.getTrendingMovies(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktTrendingShows = createTraktHook(
    ["shows", "trending"],
    (limit = 20) => traktClient.getTrendingShows(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktPopularMovies = createTraktHook(
    ["movies", "popular"],
    (limit = 20) => traktClient.getPopularMovies(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktPopularShows = createTraktHook(
    ["shows", "popular"],
    (limit = 20) => traktClient.getPopularShows(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktMostWatchedMovies = createTraktHook(
    ["movies", "watched"],
    (period = "weekly", limit = 20) => traktClient.getMostWatchedMovies(period, limit),
    CACHE_DURATION.STANDARD
);

export const useTraktMostWatchedShows = createTraktHook(
    ["shows", "watched"],
    (period = "weekly", limit = 20) => traktClient.getMostWatchedShows(period, limit),
    CACHE_DURATION.STANDARD
);

export const useTraktAnticipatedMovies = createTraktHook(
    ["movies", "anticipated"],
    (limit = 20) => traktClient.getAnticipatedMovies(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktAnticipatedShows = createTraktHook(
    ["shows", "anticipated"],
    (limit = 20) => traktClient.getAnticipatedShows(limit),
    CACHE_DURATION.STANDARD
);

export const useTraktBoxOfficeMovies = createTraktHook(
    ["movies", "boxoffice"],
    () => traktClient.getBoxOfficeMovies(),
    CACHE_DURATION.STANDARD
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
    });
}

export function useTraktMedia(slug: string, type: "movie" | "show") {
    return useQuery({
        queryKey: ["trakt", "media", slug, type],
        queryFn: () => (type === "movie" ? traktClient.getMovie(slug) : traktClient.getShow(slug)),
        staleTime: CACHE_DURATION.LONG,
    });
}

export const useTraktShowEpisodes = useTraktSeasonEpisodes;

export function useTraktPeople(id: string, type: "movies" | "shows" = "movies") {
    return useQuery({
        queryKey: ["trakt", "people", id, type],
        queryFn: () => traktClient.getPeople(id, type),
        staleTime: CACHE_DURATION.LONG,
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
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
    });
}

export function useTraktWatchlistShows() {
    return useQuery({
        queryKey: ["trakt", "watchlist", "shows"],
        queryFn: () => traktClient.getWatchlist("shows", "added"),
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
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
        enabled: !!traktClient.getAccessToken(),
    });
}

export function useTraktFavoritesShows() {
    return useQuery({
        queryKey: ["trakt", "favorites", "shows"],
        queryFn: () => traktClient.getFavorites("shows"),
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
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
        enabled: !!traktClient.getAccessToken(),
    });
}

export function useTraktRatingsShows() {
    return useQuery({
        queryKey: ["trakt", "ratings", "shows"],
        queryFn: () => traktClient.getRatings("shows"),
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
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
            queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
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
        enabled: !!id,
    });
}

// Calendar hooks (require auth)
export function useTraktCalendarShows(days = 14) {
    return useQuery({
        queryKey: ["trakt", "calendar", "shows", days],
        queryFn: () => traktClient.getCalendarShows(undefined, days),
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
    });
}

export function useTraktCalendarMovies(days = 30) {
    return useQuery({
        queryKey: ["trakt", "calendar", "movies", days],
        queryFn: () => traktClient.getCalendarMovies(undefined, days),
        staleTime: CACHE_DURATION.SHORT,
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
        staleTime: CACHE_DURATION.SHORT,
        enabled: !!traktClient.getAccessToken(),
    });
}
