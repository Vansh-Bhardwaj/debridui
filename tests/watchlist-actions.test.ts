import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

let actor = { userId: "account-a", profileId: "profile-a" };
let condition: SQL | undefined;
let inserted: unknown;
let conflicts: unknown;
let deletes = 0;
const chain = {
    from: () => chain,
    where: (sql: SQL) => { condition = sql; return chain; },
    orderBy: async () => [],
    values: (values: unknown) => { inserted = values; return chain; },
    onConflictDoUpdate: async (options: unknown) => { conflicts = options; },
    onConflictDoNothing: async () => {},
};

mock.module("../lib/auth/actor", () => ({ getActor: async () => actor }));
mock.module("../lib/db", () => ({ db: { select: () => chain, insert: () => chain, delete: () => { deletes++; return chain; } } }));
const { getLocalWatchlist, mirrorTraktWatchlist, setLocalWatchlist } = await import("../lib/actions/watchlist");
const media = { title: "A show", year: 2020, ids: { trakt: 12, tmdb: 34, slug: "a-show", imdb: "tt123" } };
const params = () => new PgDialect().sqlToQuery(condition!).params;

beforeEach(() => {
    actor = { userId: "account-a", profileId: "profile-a" };
    condition = undefined;
    inserted = undefined;
    conflicts = undefined;
    deletes = 0;
});

describe("server-side profile watchlist", () => {
    test("reads and deletes are scoped to both account and profile", async () => {
        await getLocalWatchlist("profile-a");
        expect(params()).toEqual(["account-a", "profile-a"]);
        await setLocalWatchlist("show", media, false, "profile-a");
        expect(params()).toEqual(["account-a", "profile-a", "show", "tt123"]);
        expect(deletes).toBe(1);
    });
    test("saves actor-owned rows idempotently and keeps metadata for offline Trakt access", async () => {
        await setLocalWatchlist("show", media, true, "profile-a");
        expect(inserted).toEqual({ userId: "account-a", profileId: "profile-a", mediaId: "tt123", type: "show", media });
        expect(conflicts).toBeDefined();
    });
    test("rejects stale writes after switching profile", async () => {
        actor.profileId = "profile-b";
        await expect(setLocalWatchlist("show", media, true, "profile-a")).rejects.toThrow("Profile changed");
        await expect(mirrorTraktWatchlist("show", [media], "profile-a")).rejects.toThrow("Profile changed");
        await expect(getLocalWatchlist("profile-a")).rejects.toThrow("Profile changed");
        expect(inserted).toBeUndefined();
    });
    test("Trakt mirroring merges unique titles without deleting local titles", async () => {
        await mirrorTraktWatchlist("show", [media, media], "profile-a");
        expect(inserted).toEqual([{ userId: "account-a", profileId: "profile-a", mediaId: "tt123", type: "show", media }]);
        expect(deletes).toBe(0);
        await mirrorTraktWatchlist("show", [], "profile-a");
        expect(deletes).toBe(0);
    });
    test("rejects missing identifiers", async () => {
        await expect(setLocalWatchlist("movie", { title: "Missing IDs", year: 2026 }, true, "profile-a")).rejects.toThrow("Invalid watchlist title");
        expect(inserted).toBeUndefined();
    });
});
