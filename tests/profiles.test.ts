import { describe, expect, test } from "bun:test";
import { OwnershipCache, signProfile, verifyProfile } from "../lib/auth/profile-cookie";
import { createProfileSchema, profileIdSchema, profilePreferencesSchema, updateProfileSchema } from "../lib/schemas";

const profileId = "b366f339-aa4f-4cdd-a982-bec575590f7a";
const otherId = "e37aca7b-cb23-4657-9cde-acad033b8b6d";
const secret = "test-profile-secret-with-at-least-32-characters";

describe("profile cookie signatures", () => {
    test("round trips and binds the cookie to its user", async () => {
        const value = await signProfile("user-a", profileId, secret);
        expect(await verifyProfile(value, "user-a", secret)).toBe(profileId);
        expect(await verifyProfile(value, "user-b", secret)).toBeNull();
    });
    test("rejects altered profile IDs, signatures and secrets", async () => {
        const value = await signProfile("user-a", profileId, secret);
        expect(await verifyProfile(value.replace(profileId, otherId), "user-a", secret)).toBeNull();
        const [id, signature] = value.split(".");
        const changed = `${id}.${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
        expect(await verifyProfile(changed, "user-a", secret)).toBeNull();
        expect(await verifyProfile(value, "user-a", "another-secret")).toBeNull();
    });
    test("rejects absent, malformed and oversized cookies", async () => {
        for (const value of [undefined, "", profileId, "not-a-uuid.signature", `${profileId}.@@@`, "a".repeat(101), `${await signProfile("user-a", profileId, secret)}.extra`]) {
            expect(await verifyProfile(value, "user-a", secret)).toBeNull();
        }
    });
    test("requires a signing secret", async () => {
        await expect(signProfile("user-a", profileId, "")).rejects.toThrow();
    });
});

describe("profile ownership cache", () => {
    test("isolates users and expires without extending TTL on reads", () => {
        const cache = new OwnershipCache(30, 5);
        cache.add("a", profileId, 100);
        expect(cache.has("a", profileId, 129)).toBe(true);
        expect(cache.has("b", profileId, 129)).toBe(false);
        expect(cache.has("a", otherId, 129)).toBe(false);
        expect(cache.has("a", profileId, 130)).toBe(false);
    });
    test("invalidates deleted profiles and bounds memory", () => {
        const cache = new OwnershipCache(30, 2);
        cache.add("a", profileId, 100);
        cache.add("a", otherId, 100);
        cache.add("b", profileId, 100);
        expect(cache.has("a", profileId, 101)).toBe(false);
        expect(cache.has("a", otherId, 101)).toBe(true);
        cache.invalidate("a", otherId);
        expect(cache.has("a", otherId, 101)).toBe(false);
        expect(cache.has("b", profileId, 101)).toBe(true);
    });
});

describe("profile validation", () => {
    test("trims names, permits cleared cosmetics, rejects invalid input", () => {
        expect(createProfileSchema.parse({ name: "  Alice  " }).name).toBe("Alice");
        expect(updateProfileSchema.parse({ avatar: null, color: null })).toEqual({ avatar: null, color: null });
        for (const name of ["", "   ", "a".repeat(51)]) expect(createProfileSchema.safeParse({ name }).success).toBe(false);
        expect(createProfileSchema.safeParse({ name: "A", color: "red" }).success).toBe(false);
        expect(profileIdSchema.safeParse("bad").success).toBe(false);
    });
    test("preferences cannot overwrite shared settings or Trakt tokens", () => {
        expect(profilePreferencesSchema.safeParse({ language: "en", autoplay: true }).success).toBe(true);
        expect(profilePreferencesSchema.safeParse({ tmdb_api_key: "key" }).success).toBe(false);
        expect(profilePreferencesSchema.safeParse({ trakt_access_token: "token" }).success).toBe(false);
        expect(profilePreferencesSchema.safeParse({ language: "a".repeat(16_384) }).success).toBe(false);
    });
});
