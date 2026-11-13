import { describe, expect, test } from "bun:test";
import { migrateProgressKeys, progressStorageKey } from "../hooks/profile-storage";

function storage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        get length() { return values.size; },
        key: (i: number) => [...values.keys()][i] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => values.clear(),
    };
}

describe("profile progress storage", () => {
    test("namespaces movies and episodes", () => {
        expect(progressStorageKey("one", { imdbId: "tt123", type: "movie" })).toBe("progress:one:tt123");
        expect(progressStorageKey("two", { imdbId: "tt123", type: "show", season: 0, episode: 2 })).toBe("progress:two:tt123:s0e2");
    });

    test("moves all legacy keys into the oldest profile, preserving device keys", () => {
        const local = storage({ "progress:tt123": "movie", "progress:tt456:s1e2": "episode", volume: "0.5", "selected-account-id": "account" });
        migrateProgressKeys(local, "oldest");
        expect(local.getItem("progress:oldest:tt123")).toBe("movie");
        expect(local.getItem("progress:oldest:tt456:s1e2")).toBe("episode");
        expect(local.getItem("progress:tt123")).toBeNull();
        expect(local.getItem("progress:tt456:s1e2")).toBeNull();
        expect(local.getItem("volume")).toBe("0.5");
        expect(local.getItem("selected-account-id")).toBe("account");
    });

    test("preserves existing scoped values and ignores other profiles or malformed keys", () => {
        const local = storage({ "progress:tt123": "old", "progress:one:tt123": "new", "progress:two:tt456": "other", "progress:bad": "invalid" });
        migrateProgressKeys(local, "one");
        expect(local.getItem("progress:one:tt123")).toBe("new");
        expect(local.getItem("progress:two:tt456")).toBe("other");
        expect(local.getItem("progress:bad")).toBe("invalid");
    });

    test("runs once even when switching profiles or called again", () => {
        const local = storage({ "progress:tt123": "movie" });
        migrateProgressKeys(local, "one");
        migrateProgressKeys(local, "two");
        expect(local.getItem("progress:one:tt123")).toBe("movie");
        expect(local.getItem("progress:two:tt123")).toBeNull();
        expect(local.getItem("dui-progress-migrated")).toBe("one");
    });

    test("a failed copy leaves the legacy key and allows retry", () => {
        const local = storage({ "progress:tt123": "movie" });
        const failing = { ...local, setItem: () => { throw new Error("quota"); } };
        expect(() => migrateProgressKeys(failing, "one")).toThrow("quota");
        expect(local.getItem("progress:tt123")).toBe("movie");
        expect(local.getItem("dui-progress-migrated")).toBeNull();
        migrateProgressKeys(local, "one");
        expect(local.getItem("progress:one:tt123")).toBe("movie");
    });
});

test("preferences migrate to the first profile, isolate settings and keep device settings global", async () => {
    const local = storage({ "debridui-settings": JSON.stringify({ state: { settings: { tvMode: true, deviceSync: true, smartOrder: true, playback: { subtitleSize: 30 } } }, version: 0 }) });
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
    try {
        const { loadProfilePreferences, useSettingsStore } = await import("../lib/stores/settings");
        await loadProfilePreferences("second", "first", {});
        expect(useSettingsStore.getState().get("smartOrder")).toBe(false);
        expect(useSettingsStore.getState().get("tvMode")).toBe(true);
        useSettingsStore.getState().set("playback", { ...useSettingsStore.getState().get("playback"), subtitleAutoSync: false });
        useSettingsStore.getState().set("smartOrder", true);
        expect(JSON.parse(local.getItem("debridui-settings:second")!).state.settings.smartOrder).toBe(true);
        expect(JSON.parse(local.getItem("debridui-settings")!).state.settings.smartOrder).toBeUndefined();
        await loadProfilePreferences("first", "first", {});
        expect(useSettingsStore.getState().get("smartOrder")).toBe(true);
        expect(useSettingsStore.getState().get("playback").subtitleSize).toBe(30);
        expect(useSettingsStore.getState().get("playback").subtitleAutoSync).toBe(false);
        expect(useSettingsStore.getState().get("deviceSync")).toBe(true);
        await loadProfilePreferences("second", "first", { smartOrder: false, playback: { subtitleSize: 40, subtitleAutoSync: true } });
        expect(useSettingsStore.getState().get("smartOrder")).toBe(false);
        expect(useSettingsStore.getState().get("playback").subtitleSize).toBe(40);
        expect(useSettingsStore.getState().get("playback").autoResume).toBe(true);
        expect(useSettingsStore.getState().get("playback").subtitleAutoSync).toBe(false);
    } finally {
        if (previous) Object.defineProperty(globalThis, "localStorage", previous);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});
