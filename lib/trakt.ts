// Types and Interfaces
export interface TraktIds {
    trakt: number;
    slug: string;
    tvdb?: number;
    imdb?: string;
    tmdb: number;
}

export interface TraktMedia {
    title: string;
    year: number;
    ids?: TraktIds;
    images?: TraktImages;
    overview?: string;
    rating?: number;
    votes?: number;
    runtime?: number;
    genres?: string[];
    language?: string;
    country?: string;
    trailer?: string;
    homepage?: string;
    status?: string;
    /** Movie release date (YYYY-MM-DD) from extended=full */
    released?: string;
    /** Show first aired date (ISO 8601) */
    first_aired?: string;
    aired_episodes?: number;
    certification?: string;
}

export interface TraktSeason {
    number: number;
    ids: TraktIds;
    images?: TraktImages;
    title?: string;
    overview?: string;
    rating?: number;
    votes?: number;
    episode_count?: number;
    aired_episodes?: number;
    first_aired?: string;
}

export interface TraktEpisode {
    season: number;
    number: number;
    title: string;
    ids: TraktIds;
    images?: TraktImages;
    number_abs?: number;
    overview?: string;
    first_aired?: string; // ISO date
    updated_at?: string; // ISO date
    rating?: number;
    votes?: number;
    comment_count?: number;
    available_translations?: string[]; // ISO language codes (en, es, fr, de, etc.)
    runtime?: number;
    episode_type?: string; // standard, series_premiere, mid_season_finale, mid_season_premiere, season_finale, series_finale
    original_title?: string;
}

export interface TraktImages {
    fanart: string[];
    poster: string[];
    logo: string[];
    clearart: string[];
    banner: string[];
    thumb: string[];
    headshot: string[];
    screenshot: string[];
}

export interface TraktPerson {
    name: string;
    ids: TraktIds;
    images?: Pick<TraktImages, "headshot" | "fanart">;
}

export interface TraktPersonFull extends TraktPerson {
    social_ids?: {
        twitter?: string;
        facebook?: string;
        instagram?: string;
        wikipedia?: string;
    };
    biography?: string;
    birthday?: string;
    death?: string;
    birthplace?: string;
    homepage?: string;
    gender?: string;
    known_for_department?: string;
}

export interface TraktPersonMovieCredit {
    characters?: string[];
    jobs?: string[];
    movie: TraktMedia;
}

export interface TraktPersonShowCredit {
    characters?: string[];
    jobs?: string[];
    episode_count?: number;
    series_regular?: boolean;
    show: TraktMedia;
}

export interface TraktPersonMovieCredits {
    cast?: TraktPersonMovieCredit[];
    crew?: {
        production?: TraktPersonMovieCredit[];
        art?: TraktPersonMovieCredit[];
        crew?: TraktPersonMovieCredit[];
        "costume & make-up"?: TraktPersonMovieCredit[];
        directing?: TraktPersonMovieCredit[];
        writing?: TraktPersonMovieCredit[];
        sound?: TraktPersonMovieCredit[];
        camera?: TraktPersonMovieCredit[];
        editing?: TraktPersonMovieCredit[];
        "visual effects"?: TraktPersonMovieCredit[];
    };
}

export interface TraktPersonShowCredits {
    cast?: TraktPersonShowCredit[];
    crew?: {
        production?: TraktPersonShowCredit[];
        art?: TraktPersonShowCredit[];
        crew?: TraktPersonShowCredit[];
        "costume & make-up"?: TraktPersonShowCredit[];
        directing?: TraktPersonShowCredit[];
        writing?: TraktPersonShowCredit[];
        sound?: TraktPersonShowCredit[];
        camera?: TraktPersonShowCredit[];
        editing?: TraktPersonShowCredit[];
        "visual effects"?: TraktPersonShowCredit[];
        "created by"?: TraktPersonShowCredit[];
    };
}

export interface TraktCastMember {
    characters: string[];
    person: TraktPerson;
    episode_count?: number; // only for shows
}

export interface TraktCrewMember {
    jobs?: string[];
    job?: string[];
    person: TraktPerson;
}

export interface TraktCrew {
    production?: TraktCrewMember[];
    art?: TraktCrewMember[];
    crew?: TraktCrewMember[];
    "costume & make-up"?: TraktCrewMember[];
    directing?: TraktCrewMember[];
    writing?: TraktCrewMember[];
    sound?: TraktCrewMember[];
    camera?: TraktCrewMember[];
}

export interface TraktCastAndCrew {
    cast: TraktCastMember[];
    crew: TraktCrew;
}

export interface TraktMediaItem {
    movie?: TraktMedia;
    show?: TraktMedia;
    watchers?: number;
    plays?: number;
    collected?: number;
    collectors?: number;
}

export interface TraktSearchResult {
    type: "movie" | "show" | "episode" | "person";
    score: number;
    movie?: TraktMedia;
    show?: TraktMedia;
}

export interface TraktUserProfile {
    username: string;
    private: boolean;
    name: string;
    vip: boolean;
    vip_ep: boolean;
    ids: {
        slug: string;
        uuid: string;
    };
    joined_at: string;
    location: string;
    about: string;
    gender: string;
    age: number;
    images: {
        avatar: {
            full: string;
        };
    };
    vip_og: boolean;
    vip_years: number;
}

export interface TraktUserAccount {
    timezone: string;
    date_format: string;
    time_24hr: boolean;
    cover_image: string;
}

export interface TraktUserSettings {
    user: TraktUserProfile;
    account: TraktUserAccount;
    sharing_text: {
        watching: string;
        watched: string;
        rated: string;
    };
    limits: {
        list: {
            count: number;
            item_count: number;
        };
        watchlist: {
            item_count: number;
        };
        favorites: {
            item_count: number;
        };
    };
}

export interface TraktListIds {
    trakt: number;
    slug: string;
}

export interface TraktListUser {
    username: string;
    private: boolean;
    name: string;
    vip: boolean;
    vip_ep: boolean;
    ids: {
        slug: string;
    };
}

export interface TraktList {
    name: string;
    description: string;
    privacy: string;
    share_link: string;
    type: string;
    display_numbers: boolean;
    allow_comments: boolean;
    sort_by: string;
    sort_how: string;
    created_at: string;
    updated_at: string;
    item_count: number;
    comment_count: number;
    likes: number;
    ids: TraktListIds;
    user: TraktListUser;
}

export interface TraktListContainer {
    list: TraktList;
}

export interface TraktWatchlistItem {
    rank: number;
    id: number;
    listed_at: string;
    notes: string | null;
    type: "movie" | "show";
    movie?: TraktMedia;
    show?: TraktMedia;
}

export interface TraktCollectionItem {
    last_collected_at: string;
    last_updated_at: string;
    movie?: TraktMedia;
    show?: TraktMedia;
}

export type MediaType = "movie" | "show";
export type MediaTypeEndpoint = "movies" | "shows";

export interface TraktRatingItem {
    rated_at: string;
    rating: number;
    type: "movie" | "show";
    movie?: TraktMedia;
    show?: TraktMedia;
}

export interface TraktFavoriteItem {
    rank: number;
    id: number;
    listed_at: string;
    notes: string | null;
    type: "movie" | "show";
    movie?: TraktMedia;
    show?: TraktMedia;
}

export interface TraktCheckinResponse {
    id: number;
    watched_at: string;
    sharing: { twitter: boolean; tumblr: boolean };
    movie?: TraktMedia;
    episode?: TraktEpisode;
    show?: TraktMedia;
}

interface SyncIds { imdb?: string; trakt?: number }
interface SyncItems { movies?: { ids: SyncIds }[]; shows?: { ids: SyncIds }[] }
interface SyncRatingItems {
    movies?: { ids: SyncIds; rating: number }[];
    shows?: { ids: SyncIds; rating: number }[];
}

// Watched progress types
export interface TraktWatchedEpisode {
    number: number;
    completed: boolean;
    last_watched_at: string | null;
}

export interface TraktWatchedSeason {
    number: number;
    title?: string;
    aired: number;
    completed: number;
    episodes: TraktWatchedEpisode[];
}

export interface TraktShowWatchedProgress {
    aired: number;
    completed: number;
    last_watched_at: string | null;
    reset_at: string | null;
    seasons: TraktWatchedSeason[];
    next_episode?: TraktEpisode | null;
    last_episode?: TraktEpisode | null;
}

// Scrobble interfaces
export interface TraktScrobbleMovie {
    ids: { imdb?: string; tmdb?: number; trakt?: number; slug?: string };
}

export interface TraktScrobbleEpisode {
    ids: { imdb?: string; tmdb?: number; trakt?: number; tvdb?: number };
}

export interface TraktScrobbleShow {
    ids: { imdb?: string; tmdb?: number; trakt?: number; slug?: string };
}

export interface TraktScrobbleRequest {
    movie?: TraktScrobbleMovie;
    episode?: TraktScrobbleEpisode;
    show?: TraktScrobbleShow;
    progress: number; // 0-100
}

export interface TraktScrobbleResponse {
    id: number;
    action: "start" | "pause" | "scrobble";
    progress: number;
    sharing: { twitter: boolean; tumblr: boolean };
    movie?: TraktMedia;
    episode?: TraktEpisode;
    show?: TraktMedia;
}

export interface TraktCalendarItem {
    first_aired?: string;
    released?: string;
    episode?: TraktEpisode;
    show?: TraktMedia;
    movie?: TraktMedia;
}

export interface TraktTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    created_at: number;
}

// Configuration interface
export interface TraktClientConfig {
    clientId: string;
    accessToken?: string;
    baseUrl?: string;
    apiVersion?: string;
}

// Error classes
export class TraktError extends Error {
    constructor(
        message: string,
        public status?: number,
        public endpoint?: string
    ) {
        super(message);
        this.name = "TraktError";
    }
}

export class TraktClient {
    private readonly baseUrl: string;
    private readonly clientId: string;
    private readonly apiVersion: string;
    private accessToken?: string;

    constructor(config: TraktClientConfig) {
        this.baseUrl = config.baseUrl || "https://api.trakt.tv";
        this.clientId = config.clientId;
        this.accessToken = config.accessToken;
        this.apiVersion = config.apiVersion || "2";
    }

    /**
     * Set or update the access token for authenticated requests
     */
    public setAccessToken(token: string): void {
        this.accessToken = token;
    }

    /**
     * Get the current access token
     */
    public getAccessToken(): string | undefined {
        return this.accessToken;
    }

    /**
     * Create headers for API requests
     */
    private createHeaders(requiresAuth = false): HeadersInit {
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            "trakt-api-version": this.apiVersion,
            "trakt-api-key": this.clientId,
        };

        if (requiresAuth) {
            if (!this.accessToken) {
                throw new TraktError("Access token is required for this operation");
            }
            headers["Authorization"] = `Bearer ${this.accessToken}`;
        }

        return headers;
    }

    /**
     * Make HTTP request to Trakt API
     */
    private async makeRequest<T>(
        endpoint: string,
        options: RequestInit = {},
        requiresAuth = false,
        extended?: string
    ): Promise<T> {
        let url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}`;

        // Add extended parameter if provided
        if (extended) {
            const separator = url.includes("?") ? "&" : "?";
            url = `${url}${separator}extended=${extended}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...this.createHeaders(requiresAuth),
                    ...options.headers,
                },
            });

            if (!response.ok) {
                throw new TraktError(`API request failed: ${response.statusText}`, response.status, endpoint);
            }

            // Handle empty responses (204 No Content)
            if (response.status === 204) {
                return {} as T;
            }

            const data = await response.json();
            return data as T;
        } catch (error) {
            if (error instanceof TraktError) {
                throw error;
            }
            throw new TraktError(
                `Request failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                undefined,
                endpoint
            );
        }
    }

    /**
     * Make paginated requests to fetch all items
     */
    private async makePaginatedRequest<T>(
        endpoint: string,
        params: Record<string, string | number> = {},
        requiresAuth = false,
        limit = 100
    ): Promise<T[]> {
        let page = 1;
        let allItems: T[] = [];

        while (true) {
            const searchParams = new URLSearchParams({
                ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
                page: String(page),
                limit: String(limit),
            });

            const paginatedEndpoint = `${endpoint}?${searchParams}`;
            const items = await this.makeRequest<T[]>(paginatedEndpoint, {}, requiresAuth);

            if (items.length === 0) break;

            allItems = [...allItems, ...items];
            if (items.length < limit) break;

            page++;
        }

        return allItems;
    }

    // Search Methods
    /**
     * Search for movies and shows
     */
    public async search(
        query: string,
        types: MediaType[] = ["movie", "show"],
        extended = "images"
    ): Promise<TraktSearchResult[]> {
        if (!query.trim()) {
            return [];
        }

        const typeParam = types.join(",");
        const endpoint = `search/${typeParam}?query=${encodeURIComponent(query)}`;

        const results = await this.makeRequest<TraktSearchResult[]>(endpoint, {}, false, extended);

        return results
            .filter((result) => (result.type === "movie" && result.movie) || (result.type === "show" && result.show))
            .sort((a, b) => b.score - a.score);
    }

    // Convenience Methods
    /**
     * Get trending movies
     */
    public async getTrendingMovies(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`movies/trending?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get trending shows
     */
    public async getTrendingShows(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`shows/trending?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get trending mixed (movies and shows) sorted by watchers
     */
    public async getTrendingMixed(limit = 20, extended = "full,images"): Promise<{ mixed: TraktMediaItem[] }> {
        const [movies, shows] = await Promise.all([
            this.getTrendingMovies(limit, extended),
            this.getTrendingShows(limit, extended),
        ]);

        // Combine and sort by watchers (descending)
        const mixed = [...movies, ...shows].sort((a, b) => (b.watchers || 0) - (a.watchers || 0)).slice(0, limit);

        return { mixed };
    }

    /**
     * Get popular movies
     */
    public async getPopularMovies(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        const movies = await this.makeRequest<TraktMedia[]>(`movies/popular?limit=${limit}`, {}, false, extended);
        return movies.map((movie) => ({ movie }));
    }

    /**
     * Get popular shows
     */
    public async getPopularShows(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        const shows = await this.makeRequest<TraktMedia[]>(`shows/popular?limit=${limit}`, {}, false, extended);
        return shows.map((show) => ({ show }));
    }

    /**
     * Get most watched movies
     */
    public async getMostWatchedMovies(
        period = "weekly",
        limit = 20,
        extended = "full,images"
    ): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`movies/watched/${period}?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get most watched shows
     */
    public async getMostWatchedShows(
        period = "weekly",
        limit = 20,
        extended = "full,images"
    ): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`shows/watched/${period}?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get anticipated movies
     */
    public async getAnticipatedMovies(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`movies/anticipated?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get anticipated shows
     */
    public async getAnticipatedShows(limit = 20, extended = "full,images"): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`shows/anticipated?limit=${limit}`, {}, false, extended);
    }

    /**
     * Get box office movies
     */
    public async getBoxOfficeMovies(extended = "full,images"): Promise<TraktMediaItem[]> {
        return this.makeRequest<TraktMediaItem[]>(`movies/boxoffice`, {}, false, extended);
    }

    /**
     * Get movie by ID
     */
    public async getMovie(id: string, extended = "full,images"): Promise<TraktMedia> {
        return this.makeRequest<TraktMedia>(`movies/${id}`, {}, false, extended);
    }

    /**
     * Get show by ID
     */
    public async getShow(id: string, extended = "full,images"): Promise<TraktMedia> {
        return this.makeRequest<TraktMedia>(`shows/${id}`, {}, false, extended);
    }

    /**
     * Get show seasons
     */
    public async getShowSeasons(id: string, extended = "full,images"): Promise<TraktSeason[]> {
        return this.makeRequest<TraktSeason[]>(`shows/${id}/seasons`, {}, false, extended);
    }

    /**
     * Get show episodes
     */
    public async getShowEpisodes(id: string, season: number, extended = "full,images"): Promise<TraktEpisode[]> {
        return this.makeRequest<TraktEpisode[]>(`shows/${id}/seasons/${season}/episodes`, {}, false, extended);
    }

    /**
     * Get cast and crew for a movie or show
     */
    public async getPeople(id: string, type: "movies" | "shows", extended = "full,images"): Promise<TraktCastAndCrew> {
        return this.makeRequest<TraktCastAndCrew>(`${type}/${id}/people`, {}, false, extended);
    }

    /**
     * Get person details by ID/slug
     */
    public async getPerson(id: string, extended = "full,images"): Promise<TraktPersonFull> {
        return this.makeRequest<TraktPersonFull>(`people/${id}`, {}, false, extended);
    }

    /**
     * Get person's movie credits
     */
    public async getPersonMovies(id: string, extended = "full,images"): Promise<TraktPersonMovieCredits> {
        return this.makeRequest<TraktPersonMovieCredits>(`people/${id}/movies`, {}, false, extended);
    }

    /**
     * Get person's show credits
     */
    public async getPersonShows(id: string, extended = "full,images"): Promise<TraktPersonShowCredits> {
        return this.makeRequest<TraktPersonShowCredits>(`people/${id}/shows`, {}, false, extended);
    }

    // ── Watchlist Methods (require auth) ────────────────────────────────

    /** Get user's watchlist — movies and shows they want to watch */
    public async getWatchlist(
        type: "movies" | "shows" = "movies",
        sort: "rank" | "added" | "released" | "title" = "added",
        extended = "full,images"
    ): Promise<TraktWatchlistItem[]> {
        return this.makeRequest<TraktWatchlistItem[]>(`sync/watchlist/${type}/${sort}`, {}, true, extended);
    }

    /** Add items to watchlist */
    public async addToWatchlist(items: SyncItems) {
        return this.makeRequest("sync/watchlist", { method: "POST", body: JSON.stringify(items) }, true);
    }

    /** Remove items from watchlist */
    public async removeFromWatchlist(items: SyncItems) {
        return this.makeRequest("sync/watchlist/remove", { method: "POST", body: JSON.stringify(items) }, true);
    }

    // ── Favorites Methods (require auth) ─────────────────────────────────

    /** Get user's favorites */
    public async getFavorites(
        type: "movies" | "shows" = "movies",
        extended = "full,images"
    ): Promise<TraktFavoriteItem[]> {
        return this.makeRequest<TraktFavoriteItem[]>(`sync/favorites/${type}`, {}, true, extended);
    }

    /** Add items to favorites */
    public async addToFavorites(items: SyncItems) {
        return this.makeRequest("sync/favorites", { method: "POST", body: JSON.stringify(items) }, true);
    }

    /** Remove items from favorites */
    public async removeFromFavorites(items: SyncItems) {
        return this.makeRequest("sync/favorites/remove", { method: "POST", body: JSON.stringify(items) }, true);
    }

    // ── Ratings Methods (require auth) ───────────────────────────────────

    /** Get user's ratings */
    public async getRatings(
        type: "movies" | "shows" = "movies",
        extended = "full,images"
    ): Promise<TraktRatingItem[]> {
        return this.makeRequest<TraktRatingItem[]>(`sync/ratings/${type}`, {}, true, extended);
    }

    /** Add ratings */
    public async addRatings(items: SyncRatingItems) {
        return this.makeRequest("sync/ratings", { method: "POST", body: JSON.stringify(items) }, true);
    }

    /** Remove ratings */
    public async removeRatings(items: SyncItems) {
        return this.makeRequest("sync/ratings/remove", { method: "POST", body: JSON.stringify(items) }, true);
    }

    // ── Watched Progress (require auth) ────────────────────────────────

    /** Get watched progress for a show — which episodes the user has seen */
    public async getShowWatchedProgress(id: string): Promise<TraktShowWatchedProgress> {
        return this.makeRequest<TraktShowWatchedProgress>(`shows/${id}/progress/watched?hidden=false&specials=true&count_specials=false`, {}, true);
    }

    // ── History Methods (require auth) ───────────────────────────────────

    /** Add items to watched history */
    public async addToHistory(items: SyncItems) {
        return this.makeRequest("sync/history", { method: "POST", body: JSON.stringify(items) }, true);
    }

    /** Remove items from watched history */
    public async removeFromHistory(items: SyncItems) {
        return this.makeRequest("sync/history/remove", { method: "POST", body: JSON.stringify(items) }, true);
    }

    /** Add episodes to watched history using show ID + season/episode numbers */
    public async addEpisodesToHistory(showIds: SyncIds, season: number, episodeNumbers: number[]) {
        return this.makeRequest("sync/history", {
            method: "POST",
            body: JSON.stringify({
                shows: [{
                    ids: showIds,
                    seasons: [{
                        number: season,
                        episodes: episodeNumbers.map((n) => ({ number: n })),
                    }],
                }],
            }),
        }, true);
    }

    /** Remove episodes from watched history using show ID + season/episode numbers */
    public async removeEpisodesFromHistory(showIds: SyncIds, season: number, episodeNumbers: number[]) {
        return this.makeRequest("sync/history/remove", {
            method: "POST",
            body: JSON.stringify({
                shows: [{
                    ids: showIds,
                    seasons: [{
                        number: season,
                        episodes: episodeNumbers.map((n) => ({ number: n })),
                    }],
                }],
            }),
        }, true);
    }

    // ── Checkin Methods (require auth) ───────────────────────────────────

    /** Check into a movie or episode */
    public async checkin(item: { movie?: { ids: SyncIds }; episode?: { ids: SyncIds } }): Promise<TraktCheckinResponse> {
        return this.makeRequest<TraktCheckinResponse>("checkin", { method: "POST", body: JSON.stringify(item) }, true);
    }

    /** Delete active checkin */
    public async deleteCheckin() {
        return this.makeRequest("checkin", { method: "DELETE" }, true);
    }

    // ── Related Content ──────────────────────────────────────────────────

    /** Get related movies */
    public async getRelatedMovies(id: string, limit = 10, extended = "full,images"): Promise<TraktMedia[]> {
        return this.makeRequest<TraktMedia[]>(`movies/${id}/related?limit=${limit}`, {}, false, extended);
    }

    /** Get related shows */
    public async getRelatedShows(id: string, limit = 10, extended = "full,images"): Promise<TraktMedia[]> {
        return this.makeRequest<TraktMedia[]>(`shows/${id}/related?limit=${limit}`, {}, false, extended);
    }

    /** Lookup a movie/show by external ID (TMDB, IMDB, TVDB) */
    public async lookupByExternalId(
        idType: "tmdb" | "imdb" | "tvdb",
        id: string | number,
        type: "movie" | "show" = "movie",
        extended = "images"
    ): Promise<TraktSearchResult[]> {
        return this.makeRequest<TraktSearchResult[]>(
            `search/${idType}/${id}?type=${type}`,
            {},
            false,
            extended
        );
    }

    // ── Calendar Methods (require auth) ─────────────────────────────────

    /** Get user's personalized calendar — upcoming episodes for shows they watch */
    public async getCalendarShows(startDate?: string, days = 14, extended = "full,images"): Promise<TraktCalendarItem[]> {
        const start = startDate || new Date().toISOString().slice(0, 10);
        return this.makeRequest<TraktCalendarItem[]>(`calendars/my/shows/${start}/${days}`, {}, true, extended);
    }

    /** Get user's personalized calendar — upcoming movie releases */
    public async getCalendarMovies(startDate?: string, days = 30, extended = "full,images"): Promise<TraktCalendarItem[]> {
        const start = startDate || new Date().toISOString().slice(0, 10);
        return this.makeRequest<TraktCalendarItem[]>(`calendars/my/movies/${start}/${days}`, {}, true, extended);
    }

    // ── Scrobble Methods (require auth) ─────────────────────────────────

    /**
     * Start scrobbling — call when playback starts or resumes
     */
    public async scrobbleStart(request: TraktScrobbleRequest): Promise<TraktScrobbleResponse> {
        return this.makeRequest<TraktScrobbleResponse>(
            "scrobble/start",
            { method: "POST", body: JSON.stringify(request) },
            true
        );
    }

    /**
     * Pause scrobbling — call when playback is paused
     */
    public async scrobblePause(request: TraktScrobbleRequest): Promise<TraktScrobbleResponse> {
        return this.makeRequest<TraktScrobbleResponse>(
            "scrobble/pause",
            { method: "POST", body: JSON.stringify(request) },
            true
        );
    }

    /**
     * Stop scrobbling — call when playback stops. If progress >= 80%, Trakt marks it as watched.
     */
    public async scrobbleStop(request: TraktScrobbleRequest): Promise<TraktScrobbleResponse> {
        return this.makeRequest<TraktScrobbleResponse>(
            "scrobble/stop",
            { method: "POST", body: JSON.stringify(request) },
            true
        );
    }

    /**
     * Build a scrobble request payload from an IMDB ID and progress percentage.
     */
    public static buildScrobbleRequest(
        imdbId: string,
        type: "movie" | "show",
        progress: number,
        season?: number,
        episode?: number
    ): TraktScrobbleRequest {
        if (type === "movie") {
            return { movie: { ids: { imdb: imdbId } }, progress };
        }
        return {
            episode: { ids: { imdb: imdbId } },
            ...(season !== undefined && episode !== undefined
                ? { show: { ids: { imdb: imdbId } } }
                : {}),
            progress,
        };
    }

    /**
     * Exchange an OAuth authorization code for access + refresh tokens.
     * Must be called server-side (needs client secret).
     */
    public static async exchangeCode(
        code: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string,
        proxyUrl?: string
    ): Promise<TraktTokenResponse> {
        const url = "https://api.trakt.tv/oauth/token";
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "DebridUI/1.0 (+https://github.com/Vansh-Bhardwaj/debridui)",
            "trakt-api-version": "2",
            "trakt-api-key": clientId,
        };
        const body = JSON.stringify({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
        });

        let res = await fetch(url, { method: "POST", headers, body });

        // Cloudflare WAF may block Worker IPs — retry through CORS proxy
        if (res.status === 403 && proxyUrl) {
            res = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, { method: "POST", headers, body });
        }

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new TraktError(
                `Token exchange failed: ${res.status} ${res.statusText} — ${text}`,
                res.status
            );
        }
        return res.json() as Promise<TraktTokenResponse>;
    }

    /**
     * Refresh an expired access token.
     * Must be called server-side (needs client secret).
     */
    public static async refreshToken(
        refreshToken: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string,
        proxyUrl?: string
    ): Promise<TraktTokenResponse> {
        const url = "https://api.trakt.tv/oauth/token";
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "DebridUI/1.0 (+https://github.com/Vansh-Bhardwaj/debridui)",
            "trakt-api-version": "2",
            "trakt-api-key": clientId,
        };
        const body = JSON.stringify({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "refresh_token",
        });

        let res = await fetch(url, { method: "POST", headers, body });

        // Cloudflare WAF may block Worker IPs — retry through CORS proxy
        if (res.status === 403 && proxyUrl) {
            res = await fetch(`${proxyUrl}${encodeURIComponent(url)}`, { method: "POST", headers, body });
        }

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new TraktError(
                `Token refresh failed: ${res.status} ${res.statusText} — ${text}`,
                res.status
            );
        }
        return res.json() as Promise<TraktTokenResponse>;
    }
}

export const traktClient = new TraktClient({
    clientId: process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID!,
});
