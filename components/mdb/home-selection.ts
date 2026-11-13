export interface HomeHistory {
    imdbId: string;
    type: "movie" | "show";
    season?: number | null;
    episode?: number | null;
    progressSeconds: number;
    durationSeconds: number;
    watchedAt?: string;
    updatedAt?: string | number;
}

export interface HomeEpisode { season: number; episode: number; released?: string; title?: string }

export function rankGenres(titles: { genres?: string[] }[], limit = 3): string[] {
    const counts = new Map<string, number>();
    for (const title of titles) for (const genre of new Set(title.genres?.map((g) => g.toLowerCase()) ?? [])) counts.set(genre, (counts.get(genre) ?? 0) + 1);
    return counts.size ? [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([g]) => g) : ["drama", "comedy", "action"].slice(0, limit);
}

export function nextAiredEpisode(episodes: HomeEpisode[], season: number, episode: number, now = Date.now()) {
    return episodes.filter((e) => e.season > 0 && (e.season > season || e.season === season && e.episode > episode) && !!e.released && Date.parse(e.released) <= now)
        .sort((a, b) => a.season - b.season || a.episode - b.episode)[0] ?? null;
}

export function recentlyAired(episodes: HomeEpisode[], now = Date.now()) {
    return episodes.filter((e) => e.season > 0 && !!e.released && Date.parse(e.released) <= now && Date.parse(e.released) >= now - 7 * 86400000)
        .sort((a, b) => Date.parse(b.released!) - Date.parse(a.released!));
}

export function selectUpNext(episodes: HomeEpisode[], progress: HomeHistory, now = Date.now()) {
    if (progress.type !== "show" || !progress.season || !progress.episode) return null;
    // The progress API seeds an unwatched episode when its predecessor finishes.
    if (progress.progressSeconds === 0) return episodes.find((e) => e.season === progress.season && e.episode === progress.episode && !!e.released && Date.parse(e.released) <= now) ?? null;
    return nextAiredEpisode(episodes, progress.season, progress.episode, now);
}

export function recentTitles(history: HomeHistory[], finishedOnly = false, limit = 20) {
    const seen = new Set<string>();
    return [...history].sort((a, b) => new Date(b.watchedAt ?? b.updatedAt ?? 0).getTime() - new Date(a.watchedAt ?? a.updatedAt ?? 0).getTime()).filter((h) => {
        if (finishedOnly && !(h.durationSeconds > 0 && h.progressSeconds / h.durationSeconds >= 0.9)) return false;
        const key = `${h.type}:${h.imdbId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).slice(0, limit);
}
