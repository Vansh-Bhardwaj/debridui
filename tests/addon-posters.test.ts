import { afterEach, expect, spyOn, test } from "bun:test";
import { catalogMetasToMediaItems } from "../lib/addons/parser";
import { cdnUrl, getPosterUrl, resolveImageUrl } from "../lib/utils/media";
import { fetchCinemetaMeta } from "../lib/cinemeta";
import { fetchPosterFromAPIs } from "../lib/utils/poster-fallback";

const poster = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061-y5gsT1hoHuHw.png";
const wrappedPoster = `https://wsrv.nl/?${new URLSearchParams({ url: poster, w: "300", h: "450", output: "webp" })}`;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => fetchSpy?.mockRestore());

test("anime catalogs keep their source poster and addon ID", () => {
    const [item] = catalogMetasToMediaItems([{ id: "mal:11061", type: "series", name: "Hunter x Hunter", poster }]);
    expect(item.show?.images?.poster).toEqual([poster]);
    expect(item.show?.ids.imdb).toBe("mal:11061");
});

test("cached catalog posters bypass the old blocked image proxy", () => {
    expect(resolveImageUrl(wrappedPoster)).toBe(poster);
    expect(getPosterUrl({ poster: [wrappedPoster] } as Parameters<typeof getPosterUrl>[0])).toBe(poster);
    expect(cdnUrl(poster, { w: 300, h: 450 })).toBe(poster);
});

test("other source URLs retain their scheme and signed query parameters", () => {
    const signed = "https://example.com/poster.jpg?key=a%2Bb&token=x%26y";
    expect(resolveImageUrl(signed)).toBe(signed);
    expect(resolveImageUrl(`https://wsrv.nl/?url=${encodeURIComponent(signed)}`)).toBe(signed);
    expect(resolveImageUrl("image.tmdb.org/t/p/w500/poster.jpg")).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
});

test("unsupported addon IDs cause no Cinemeta or TMDB fallback requests", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
    for (const id of ["mal:11061", "kitsu:1234", "anilist:207809", "", "tt-invalid"]) {
        expect(await fetchCinemetaMeta(id, "show")).toBeNull();
        expect(await fetchPosterFromAPIs(id, "show", [])).toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
});

test("IMDb metadata requests still reach Cinemeta", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ meta: { id: "tt0903747", name: "Breaking Bad" } }));
    expect((await fetchCinemetaMeta("tt0903747", "show"))?.name).toBe("Breaking Bad");
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://v3-cinemeta.strem.io/meta/series/tt0903747.json");
});
