import {
    AddonError,
    type AddonManifest,
    type AddonStreamResponse,
    type AddonSubtitlesResponse,
    type CatalogResponse,
    type TvSearchParams,
} from "./types";

/** External CORS proxy URL — resolved at build time from env */
const CORS_PROXY = process.env.NEXT_PUBLIC_CORS_PROXY_URL || "https://corsproxy.io/?url=";


/** Check if an error is a CORS/network error (opaque failure from same-origin policy).
 * Handles both raw TypeError (from fetch) AND wrapped AddonError (from executeFetch). */
const isCorsOrNetworkError = (error: unknown): boolean => {
    if (error instanceof TypeError && error.message === "Failed to fetch") return true;
    if (error instanceof AddonError) {
        if (error.statusCode === 403) return true;
        // executeFetch wraps TypeError("Failed to fetch") into
        // AddonError("Network error: Failed to fetch") — match that too
        if (error.message.includes("Failed to fetch")) return true;
        if (error.message.includes("Network error")) return true;
    }
    return false;
};

export interface AddonClientConfig {
    url: string;
    timeout?: number;
}

export class AddonClient {
    private readonly baseUrl: string;
    private readonly timeout: number;

    constructor(config: AddonClientConfig) {
        let url = config.url?.trim();

        if (!url) {
            throw new AddonError("Addon URL is required and cannot be empty");
        }

        // Normalize URL - strip /manifest.json if present
        if (url.endsWith("/manifest.json")) {
            url = url.slice(0, -"/manifest.json".length);
        }

        // Remove trailing slash
        if (url.endsWith("/")) {
            url = url.slice(0, -1);
        }

        this.baseUrl = url;
        this.timeout = config.timeout || 1000 * 60 * 3; // 3 minutes
    }

    /**
     * Create headers for API requests.
     * 
     * IMPORTANT: Only use CORS-safe ("simple") headers here.
     * Adding non-simple headers like cache-control triggers a CORS preflight
     * request — most addon servers (including AIOStreams) don't include
     * cache-control in Access-Control-Allow-Headers, which causes the
     * direct fetch to fail entirely and forces a proxy fallback.
     */
    private getHeaders(): HeadersInit {
        return {
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
        };
    }

    /**
     * Execute a single fetch and parse JSON response
     */
    private async executeFetch<T>(url: string): Promise<T> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                headers: this.getHeaders(),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new AddonError(`HTTP ${response.status}: ${response.statusText}`, response.status);
            }

            // Try to parse as JSON regardless of content-type — many addons
            // return text/plain or omit the header entirely.
            try {
                return (await response.json()) as T;
            } catch {
                throw new AddonError("Invalid response: failed to parse JSON");
            }
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof AddonError) throw error;

            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    throw new AddonError(`Request timeout after ${this.timeout}ms`);
                }
                throw new AddonError(`Network error: ${error.message}`);
            }

            throw new AddonError("Unknown error occurred");
        }
    }

    /**
     * Make HTTP request — tries direct fetch first (bypasses proxy), falls back
     * to external CORS proxy when the addon blocks direct browser requests (CORS/403).
     */
    private async makeRequest<T>(url: string): Promise<T> {
        // Server-side: always direct
        if (typeof window === "undefined") return this.executeFetch<T>(url);

        // Client-side: try direct first to avoid proxy overhead
        try {
            const result = await this.executeFetch<T>(url);
            if (process.env.NODE_ENV === "development") {
                console.log(`[Addon] DIRECT fetch succeeded: ${url}`);
            }
            return result;
        } catch (error) {
            if (!isCorsOrNetworkError(error)) throw error;
            if (process.env.NODE_ENV === "development") {
                console.log(`[Addon] Direct fetch failed (CORS/network), trying external proxy...`);
            }
        }

        // Fallback: external CORS proxy (streams response directly, strips
        // browser headers) → then built-in API proxy as last resort
        const externalProxyUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
        try {
            const result = await this.executeFetch<T>(externalProxyUrl);
            if (process.env.NODE_ENV === "development") {
                console.log(`[Addon] EXTERNAL PROXY fetch succeeded: ${url}`);
            }
            return result;
        } catch (error) {
            if (!isCorsOrNetworkError(error)) throw error;
            if (process.env.NODE_ENV === "development") {
                console.log(`[Addon] External proxy failed, trying built-in API proxy...`);
            }
        }

        // Last resort: built-in proxy (same origin, no CORS issues)
        const apiProxyUrl = `/api/addon/proxy?url=${encodeURIComponent(url)}`;
        if (process.env.NODE_ENV === "development") {
            console.log(`[Addon] API PROXY fetch: ${url}`);
        }
        return this.executeFetch<T>(apiProxyUrl);
    }

    /**
     * Fetch addon manifest
     */
    async fetchManifest(): Promise<AddonManifest> {
        const url = `${this.baseUrl}/manifest.json`;
        const manifest = await this.makeRequest<AddonManifest>(url);

        if (!manifest.id || !manifest.name) {
            throw new AddonError("Invalid manifest: missing required fields (id, name)");
        }

        return manifest;
    }

    /**
     * Fetch streams for a movie
     */
    async fetchMovieStreams(imdbId: string): Promise<AddonStreamResponse> {
        if (!imdbId?.trim()) {
            throw new AddonError("IMDB ID is required");
        }

        const url = `${this.baseUrl}/stream/movie/${imdbId}.json`;
        const response = await this.makeRequest<AddonStreamResponse>(url);

        // Normalise: some addons return {streams: null} or omit the key entirely
        if (!response.streams || !Array.isArray(response.streams)) {
            return { streams: [] };
        }

        if (process.env.NODE_ENV === "development") {
            console.log(`[Addon] ${this.baseUrl} → movie/${imdbId}: ${response.streams.length} raw streams`);
        }

        return response;
    }

    /**
     * Fetch streams for a TV show episode
     */
    async fetchTvStreams(imdbId: string, params: TvSearchParams): Promise<AddonStreamResponse> {
        if (!imdbId?.trim()) {
            throw new AddonError("IMDB ID is required");
        }

        if (params.season < 1 || params.episode < 1) {
            throw new AddonError("Season and episode must be positive numbers");
        }

        const url = `${this.baseUrl}/stream/series/${imdbId}:${params.season}:${params.episode}.json`;
        const response = await this.makeRequest<AddonStreamResponse>(url);

        // Normalise: some addons return {streams: null} or omit the key entirely
        if (!response.streams || !Array.isArray(response.streams)) {
            return { streams: [] };
        }

        if (process.env.NODE_ENV === "development") {
            console.log(`[Addon] ${this.baseUrl} → series/${imdbId}:${params.season}:${params.episode}: ${response.streams.length} raw streams`);
        }

        return response;
    }

    /**
     * Universal fetch method
     */
    async fetchStreams(
        imdbId: string,
        mediaType: "movie" | "show",
        tvParams?: TvSearchParams
    ): Promise<AddonStreamResponse> {
        if (mediaType === "movie") {
            return this.fetchMovieStreams(imdbId);
        }

        if (!tvParams) {
            throw new AddonError("TV show requires season and episode parameters");
        }

        return this.fetchTvStreams(imdbId, tvParams);
    }

    /**
     * Fetch subtitles for a movie (Stremio protocol: /subtitles/movie/{imdbId}.json)
     */
    async fetchMovieSubtitles(imdbId: string): Promise<AddonSubtitlesResponse> {
        if (!imdbId?.trim()) {
            throw new AddonError("IMDB ID is required");
        }
        const url = `${this.baseUrl}/subtitles/movie/${imdbId}.json`;
        const response = await this.makeRequest<AddonSubtitlesResponse>(url);
        if (!response.subtitles || !Array.isArray(response.subtitles)) {
            return { subtitles: [] };
        }
        return response;
    }

    /**
     * Fetch subtitles for a TV show episode (Stremio: /subtitles/series/{imdbId}:{season}:{episode}.json)
     */
    async fetchTvSubtitles(imdbId: string, params: TvSearchParams): Promise<AddonSubtitlesResponse> {
        if (!imdbId?.trim()) {
            throw new AddonError("IMDB ID is required");
        }
        if (params.season < 1 || params.episode < 1) {
            throw new AddonError("Season and episode must be positive numbers");
        }
        const url = `${this.baseUrl}/subtitles/series/${imdbId}:${params.season}:${params.episode}.json`;
        const response = await this.makeRequest<AddonSubtitlesResponse>(url);
        if (!response.subtitles || !Array.isArray(response.subtitles)) {
            return { subtitles: [] };
        }
        return response;
    }

    /**
     * Fetch subtitles (movie or series). Only call for addons that declare "subtitles" in manifest.resources.
     */
    async fetchSubtitles(
        imdbId: string,
        mediaType: "movie" | "show",
        tvParams?: TvSearchParams
    ): Promise<AddonSubtitlesResponse> {
        if (mediaType === "movie") {
            return this.fetchMovieSubtitles(imdbId);
        }
        if (!tvParams) {
            throw new AddonError("TV show requires season and episode parameters");
        }
        return this.fetchTvSubtitles(imdbId, tvParams);
    }

    /**
     * Fetch catalog content
     */
    async fetchCatalog(type: string, catalogId: string, extra?: Record<string, string>): Promise<CatalogResponse> {
        let url = `${this.baseUrl}/catalog/${type}/${catalogId}`;

        if (extra && Object.keys(extra).length > 0) {
            const extraStr = Object.entries(extra)
                .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                .join("&");
            url += `/${extraStr}`;
        }

        url += ".json";
        const response = await this.makeRequest<CatalogResponse>(url);

        if (!response.metas || !Array.isArray(response.metas)) {
            return { metas: [] };
        }

        return response;
    }

    /**
     * Fetch URL with redirect handling (for URL-only streams)
     */
    async fetchUrlWithRedirect(url: string): Promise<string> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            // Proxying to ensure CORS compliance
            const response = await fetch(url, {
                method: "GET",
                redirect: "follow",
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Return final URL after redirects
            return response.url;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    throw new AddonError(`Request timeout after ${this.timeout}ms`);
                }
                throw new AddonError(`Failed to fetch URL: ${error.message}`);
            }

            throw new AddonError("Unknown error occurred while fetching URL");
        }
    }

    /**
     * Get base URL
     */
    getBaseUrl(): string {
        return this.baseUrl;
    }
}
