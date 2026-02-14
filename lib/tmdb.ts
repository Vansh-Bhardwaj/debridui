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
        return this.makeRequest<TMDBMovieDetails>(`/movie/${movieId}`);
    }

    public async getCollection(collectionId: number): Promise<TMDBCollectionDetails> {
        return this.makeRequest<TMDBCollectionDetails>(`/collection/${collectionId}`);
    }
}

export function createTMDBClient(apiKey?: string): TMDBClient | null {
    if (!apiKey) return null;
    return new TMDBClient({ apiKey });
}
