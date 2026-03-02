const TVMAZE_BASE = "https://api.tvmaze.com";

export interface TVMazeShow {
    id: number;
    name: string;
    type: string;
    language: string;
    genres: string[];
    status: string; // "Running" | "Ended" | "To Be Determined" | "In Development"
    runtime: number | null;
    premiered: string | null; // YYYY-MM-DD
    ended: string | null;
    officialSite: string | null;
    schedule: {
        time: string;
        days: string[];
    };
    rating: {
        average: number | null;
    };
    network: {
        id: number;
        name: string;
        country: { name: string; code: string; timezone: string } | null;
    } | null;
    webChannel: {
        id: number;
        name: string;
        country: { name: string; code: string; timezone: string } | null;
    } | null;
    externals: {
        tvrage: number | null;
        thetvdb: number | null;
        imdb: string | null;
    };
    image: {
        medium: string;
        original: string;
    } | null;
    summary: string | null;
}

/**
 * Lookup a TV show on TVMaze by IMDb ID.
 * Free, no API key required. Returns null if not found.
 */
export async function fetchTVMazeByImdb(imdbId: string): Promise<TVMazeShow | null> {
    if (!imdbId?.startsWith("tt")) return null;
    try {
        const res = await fetch(
            `${TVMAZE_BASE}/lookup/shows?imdb=${encodeURIComponent(imdbId)}`,
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Lookup a TV show on TVMaze by TVDB ID.
 * Useful when IMDb lookup fails but we have a TVDB ID from Trakt.
 */
export async function fetchTVMazeByTvdb(tvdbId: number): Promise<TVMazeShow | null> {
    if (!tvdbId || tvdbId <= 0) return null;
    try {
        const res = await fetch(
            `${TVMAZE_BASE}/lookup/shows?thetvdb=${tvdbId}`,
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

// --- Schedule ---

export interface TVMazeScheduleItem {
    id: number;
    name: string; // episode name
    season: number;
    number: number | null;
    airdate: string; // YYYY-MM-DD
    airtime: string; // HH:MM
    runtime: number | null;
    show: TVMazeShow;
}

/**
 * Fetch the TVMaze broadcast schedule for a given date.
 * Returns all episodes airing on broadcast TV on that date.
 * Country defaults to US. Free, no API key needed.
 */
export async function fetchTVMazeSchedule(
    date?: string,
    country = "US"
): Promise<TVMazeScheduleItem[]> {
    const dateParam = date || new Date().toISOString().split("T")[0];
    // Validate YYYY-MM-DD format to prevent injection
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return [];
    try {
        const res = await fetch(
            `${TVMAZE_BASE}/schedule?country=${encodeURIComponent(country)}&date=${dateParam}`,
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

// --- Search ---

export interface TVMazeSearchResult {
    score: number;
    show: TVMazeShow;
}

/**
 * Search TVMaze for TV shows by query string.
 * Free, no API key needed. Returns up to 10 results.
 */
export async function searchTVMaze(query: string): Promise<TVMazeSearchResult[]> {
    if (!query || query.length < 2) return [];
    try {
        const res = await fetch(
            `${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(query)}`,
            { signal: AbortSignal.timeout(8_000) }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}
