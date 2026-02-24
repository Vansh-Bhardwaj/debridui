// TMDB Episode Group Types
export interface TMDBEpisodeGroupNetwork {
    id: number;
    logo_path: string | null;
    name: string;
    origin_country: string;
}

export interface TMDBEpisodeGroupResult {
    description: string;
    episode_count: number;
    group_count: number;
    id: string;
    name: string;
    network: TMDBEpisodeGroupNetwork | null;
    type: number;
}

export interface TMDBEpisodeGroupsResponse {
    results: TMDBEpisodeGroupResult[];
    id: number;
}

export interface TMDBEpisodeGroupEpisode {
    air_date: string;
    episode_number: number;
    id: number;
    name: string;
    overview: string;
    production_code: string;
    runtime: number | null;
    season_number: number;
    show_id: number;
    still_path: string | null;
    vote_average: number;
    vote_count: number;
    order: number;
}

export interface TMDBEpisodeGroupGroup {
    id: string;
    name: string;
    order: number;
    episodes: TMDBEpisodeGroupEpisode[];
    locked: boolean;
}

export interface TMDBEpisodeGroupDetails {
    description: string;
    episode_count: number;
    group_count: number;
    groups: TMDBEpisodeGroupGroup[];
    id: string;
    name: string;
    network: TMDBEpisodeGroupNetwork | null;
    type: number;
}

// TMDB Movie Collection Types
export interface TMDBCollectionRef {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
}

export interface TMDBMovieSummary {
    id: number;
    title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    genre_ids: number[];
}

export interface TMDBMovieDetails {
    id: number;
    title: string;
    belongs_to_collection: TMDBCollectionRef | null;
    overview?: string;
    poster_path: string | null;
    backdrop_path: string | null;
    genres?: { id: number; name: string }[];
    runtime?: number | null;
    vote_average?: number;
    vote_count?: number;
    release_date?: string;
    imdb_id?: string | null;
    status?: string;
    homepage?: string | null;
    original_language?: string;
    certification?: string;
}

export interface TMDBTVDetails {
    id: number;
    name: string;
    overview?: string;
    poster_path: string | null;
    backdrop_path: string | null;
    genres?: { id: number; name: string }[];
    episode_run_time?: number[];
    vote_average?: number;
    vote_count?: number;
    first_air_date?: string;
    status?: string;
    homepage?: string | null;
    original_language?: string;
    number_of_seasons?: number;
    number_of_episodes?: number;
    external_ids?: { imdb_id?: string; tvdb_id?: number };
}

export interface TMDBFindResult {
    movie_results: TMDBMovieSummary[];
    tv_results: {
        id: number;
        name: string;
        overview?: string;
        poster_path: string | null;
        backdrop_path: string | null;
        first_air_date?: string;
        vote_average?: number;
        vote_count?: number;
        genre_ids?: number[];
    }[];
}

export interface TMDBCollectionDetails {
    id: number;
    name: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    parts: TMDBMovieSummary[];
}

export interface TMDBClientConfig {
    apiKey: string;
    baseUrl?: string;
    apiVersion?: string;
}

export class TMDBError extends Error {
    constructor(
        message: string,
        public status?: number,
        public endpoint?: string
    ) {
        super(message);
        this.name = "TMDBError";
    }
}

export class TMDBClient {
    private readonly baseUrl: string;
    private readonly apiKey: string;
    private readonly apiVersion: string;

    constructor(config: TMDBClientConfig) {
        this.baseUrl = config.baseUrl || "https://api.themoviedb.org";
        this.apiKey = config.apiKey;
        this.apiVersion = config.apiVersion || "3";
    }

    private async makeRequest<T>(
        endpoint: string,
        params: Record<string, string | number> = {}
    ): Promise<T> {
        const searchParams = new URLSearchParams({
            api_key: this.apiKey,
            ...Object.fromEntries(
                Object.entries(params).map(([key, value]) => [key, String(value)])
            ),
        });

        const url = `${this.baseUrl}/${this.apiVersion}${endpoint}?${searchParams}`;

        const response = await fetch(url, {
            headers: { "Content-Type": "application/json", accept: "application/json" },
        });

        if (!response.ok) {
            const errorData = (await response.json().catch(() => ({}))) as { status_message?: string };
            throw new TMDBError(
                errorData.status_message || `API request failed: ${response.statusText}`,
                response.status,
                endpoint
            );
        }

        return (await response.json()) as T;
    }

    public async getTVSeriesEpisodeGroups(seriesId: number): Promise<TMDBEpisodeGroupsResponse> {
        return this.makeRequest<TMDBEpisodeGroupsResponse>(`/tv/${seriesId}/episode_groups`);
    }

    public async getEpisodeGroupDetails(groupId: string): Promise<TMDBEpisodeGroupDetails> {
        return this.makeRequest<TMDBEpisodeGroupDetails>(`/tv/episode_group/${groupId}`);
    }

    public async getMovieDetails(movieId: number): Promise<TMDBMovieDetails> {
        return this.makeRequest<TMDBMovieDetails>(`/movie/${movieId}`, { append_to_response: "release_dates" });
    }

    public async getTVDetails(tvId: number): Promise<TMDBTVDetails> {
        return this.makeRequest<TMDBTVDetails>(`/tv/${tvId}`, { append_to_response: "external_ids" });
    }

    public async findByExternalId(imdbId: string): Promise<TMDBFindResult> {
        return this.makeRequest<TMDBFindResult>(`/find/${imdbId}`, { external_source: "imdb_id" });
    }

    /**
     * Look up an IMDB ID via TMDB's find endpoint, then fetch full details.
     * Returns a TraktMedia-shaped object for seamless fallback, or null if not found.
     */
    public async findByImdbId(imdbId: string, type: "movie" | "show"): Promise<TMDBMovieDetails | TMDBTVDetails | null> {
        const findResult = await this.findByExternalId(imdbId);

        if (type === "movie" && findResult.movie_results.length > 0) {
            return this.getMovieDetails(findResult.movie_results[0].id);
        }

        if (type === "show" && findResult.tv_results.length > 0) {
            return this.getTVDetails(findResult.tv_results[0].id);
        }

        return null;
    }

    public async getCollection(collectionId: number): Promise<TMDBCollectionDetails> {
        return this.makeRequest<TMDBCollectionDetails>(`/collection/${collectionId}`);
    }
}

export function createTMDBClient(apiKey?: string): TMDBClient | null {
    if (!apiKey) return null;
    return new TMDBClient({ apiKey });
}

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** Convert a TMDB movie or TV detail into a TraktMedia-shaped object for fallback display. */
export function tmdbToTraktMedia(
    detail: TMDBMovieDetails | TMDBTVDetails,
    type: "movie" | "show",
    imdbId?: string
): import("@/lib/trakt").TraktMedia {
    const isMovie = type === "movie";
    const movie = isMovie ? (detail as TMDBMovieDetails) : undefined;
    const tv = !isMovie ? (detail as TMDBTVDetails) : undefined;

    const posterPath = detail.poster_path;
    const backdropPath = detail.backdrop_path;

    return {
        title: movie?.title ?? tv?.name ?? "",
        year: parseInt((movie?.release_date ?? tv?.first_air_date ?? "").slice(0, 4)) || 0,
        ids: {
            trakt: 0,
            slug: imdbId ?? "",
            tmdb: detail.id,
            imdb: imdbId ?? movie?.imdb_id ?? tv?.external_ids?.imdb_id ?? undefined,
            tvdb: tv?.external_ids?.tvdb_id,
        },
        images: {
            poster: posterPath ? [`${TMDB_IMAGE_BASE}/w500${posterPath}`] : [],
            fanart: backdropPath ? [`${TMDB_IMAGE_BASE}/w1280${backdropPath}`] : [],
            logo: [],
            clearart: [],
            banner: [],
            thumb: [],
            headshot: [],
            screenshot: [],
        },
        overview: detail.overview,
        rating: detail.vote_average,
        votes: detail.vote_count,
        runtime: movie?.runtime ?? (tv?.episode_run_time?.[0] || undefined),
        genres: detail.genres?.map((g) => g.name.toLowerCase()),
        language: detail.original_language,
        status: tv?.status,
        homepage: detail.homepage || undefined,
        released: movie?.release_date,
        first_aired: tv?.first_air_date ? new Date(tv.first_air_date).toISOString() : undefined,
        aired_episodes: tv?.number_of_episodes,
    };
}
