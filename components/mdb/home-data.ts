"use client";

import { cinemetaToTraktMedia, fetchCinemetaMeta } from "@/lib/cinemeta";
import type { TraktMedia, TraktMediaItem } from "@/lib/trakt";
import type { HomeEpisode, HomeHistory } from "./home-selection";

export async function homeJson<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(url, { signal: signal ?? AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return response.json();
}

export async function showEpisodes(imdbId: string): Promise<HomeEpisode[]> {
    const { meta } = await homeJson<{ meta?: { videos?: HomeEpisode[] } }>(`https://v3-cinemeta.strem.io/meta/series/${encodeURIComponent(imdbId)}.json`);
    return meta?.videos ?? [];
}

export async function historyMetadata(history: HomeHistory[]) {
    return Promise.all(history.map(async (h) => {
        const meta = await fetchCinemetaMeta(h.imdbId, h.type);
        return { history: h, media: meta ? cinemetaToTraktMedia(meta, h.type) : null };
    }));
}

interface TmdbTitle { id: number; title?: string; name?: string; media_type?: string; release_date?: string; first_air_date?: string; poster_path?: string; backdrop_path?: string }
export async function tmdbItems(path: string, key: string, type?: "movie" | "show"): Promise<TraktMediaItem[]> {
    const data = await homeJson<{ results: TmdbTitle[] }>(`https://api.themoviedb.org/3/${path}${path.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(key)}`);
    return data.results.filter((m) => m.media_type !== "person").map((m) => {
        const kind = type ?? (m.media_type === "tv" ? "show" : "movie");
        const media: TraktMedia = {
            title: m.title || m.name || "Untitled", year: parseInt((m.release_date || m.first_air_date || "").slice(0, 4)) || 0,
            ids: { trakt: 0, tmdb: m.id, slug: `title-tmdb-${m.id}` },
            images: { poster: m.poster_path ? [`https://image.tmdb.org/t/p/w500${m.poster_path}`] : [], fanart: m.backdrop_path ? [`https://image.tmdb.org/t/p/w1280${m.backdrop_path}`] : [], logo: [], clearart: [], banner: [], thumb: [], headshot: [], screenshot: [] },
        };
        return { [kind]: media };
    });
}

export async function recommendations(media: TraktMedia, type: "movie" | "show", key: string) {
    let id = media.ids?.tmdb;
    if (!id && media.ids?.imdb) {
        const found = await homeJson<{ movie_results: { id: number }[]; tv_results: { id: number }[] }>(`https://api.themoviedb.org/3/find/${media.ids.imdb}?external_source=imdb_id&api_key=${encodeURIComponent(key)}`);
        id = (type === "movie" ? found.movie_results : found.tv_results)[0]?.id;
    }
    return id ? tmdbItems(`${type === "show" ? "tv" : "movie"}/${id}/recommendations`, key, type) : [];
}
