import { describe, expect, test } from "bun:test";
import { dedupeItems, idKeys } from "../components/mdb/home-dedup";
import type { TraktMediaItem } from "../lib/trakt";

const movie = (ids: Record<string, string | number>) => ({ movie: { title: "x", ids } }) as unknown as TraktMediaItem;

describe("home de-duplication", () => {
    test("keys every known id", () => {
        expect(idKeys({ imdb: "tt1", tmdb: 2, trakt: 3 } as never)).toEqual(["imdb:tt1", "tmdb:2", "trakt:3"]);
        expect(idKeys(undefined)).toEqual([]);
    });

    test("drops titles shown elsewhere by any shared id", () => {
        const items = [movie({ imdb: "tt1" }), movie({ tmdb: 5 }), movie({ imdb: "tt9", tmdb: 9 })];
        const shown = new Set(["imdb:tt1", "tmdb:5"]);
        expect(dedupeItems(items, shown)).toEqual([items[2]]);
    });

    test("keeps everything when nothing is shown and leaves the input untouched", () => {
        const items = [movie({ imdb: "tt1" })];
        expect(dedupeItems(items, new Set())).toEqual(items);
        expect(items).toHaveLength(1);
    });
});
