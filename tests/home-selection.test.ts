import { describe, expect, test } from "bun:test";
import { nextAiredEpisode, rankGenres, recentTitles, recentlyAired, selectUpNext } from "../components/mdb/home-selection";

const now = Date.parse("2026-11-13T12:00:00Z");
const episodes = [
    { season: 0, episode: 1, released: "2026-11-12T12:00:00Z" },
    { season: 1, episode: 9, released: "2026-11-06T12:00:00Z" },
    { season: 1, episode: 10, released: "2026-11-12T12:00:00Z" },
    { season: 2, episode: 1, released: "2026-11-13T12:00:00Z" },
    { season: 2, episode: 2, released: "2026-11-14T12:00:00Z" },
    { season: 2, episode: 3 },
];

describe("profile home selection", () => {
    test("ranks genres per title, with stable ties and popular fallback", () => {
        expect(rankGenres([{ genres: ["Drama", "drama", "Comedy"] }, { genres: ["Action", "Drama"] }])).toEqual(["drama", "action", "comedy"]);
        expect(rankGenres([])).toEqual(["drama", "comedy", "action"]);
    });
    test("Up Next crosses seasons and excludes future, specials and undated episodes", () => {
        expect(nextAiredEpisode(episodes, 1, 10, now)).toEqual(episodes[3]);
        expect(nextAiredEpisode(episodes, 2, 1, now)).toBeNull();
        expect(nextAiredEpisode([...episodes].reverse(), 1, 9, now)).toEqual(episodes[2]);
    });
    test("Up Next preserves an unwatched episode seeded by progress", () => {
        const progress = { imdbId: "tt1", type: "show" as const, season: 1, episode: 10, progressSeconds: 0, durationSeconds: 2400 };
        expect(selectUpNext(episodes, progress, now)).toEqual(episodes[2]);
        expect(selectUpNext(episodes, { ...progress, progressSeconds: 1800 }, now)).toEqual(episodes[3]);
        expect(selectUpNext(episodes, { ...progress, type: "movie" }, now)).toBeNull();
    });
    test("New Episodes includes precisely the past seven days, newest first", () => {
        expect(recentlyAired(episodes, now)).toEqual([episodes[3], episodes[2], episodes[1]]);
        expect(recentlyAired([{ season: 1, episode: 1, released: "2026-11-06T11:59:59Z" }], now)).toEqual([]);
    });
    test("finished seeds are recent, unique, and exclude partial or zero-duration watches", () => {
        const base = { imdbId: "tt1", type: "movie" as const, progressSeconds: 90, durationSeconds: 100 };
        expect(recentTitles([{ ...base, watchedAt: "2026-11-12" }, { ...base, watchedAt: "2026-11-13" }, { ...base, imdbId: "tt2", progressSeconds: 20 }, { ...base, imdbId: "tt3", durationSeconds: 0 }], true)).toEqual([{ ...base, watchedAt: "2026-11-13" }]);
    });
});
