import { describe, expect, test } from "bun:test";
import {
    filterSettings,
    settingsRegistry,
    settingsSections,
    type SettingEntry,
    type SettingsContext,
} from "../lib/settings/registry";
import type { DeviceClass } from "../lib/device/detect";

const context: SettingsContext = { device: "desktop", isTorbox: false, isTraktConnected: false };
const ids = (device: DeviceClass) => filterSettings({ ...context, device }).map((entry) => entry.id);

describe("settings registry", () => {
    test("has unique ids and covers every section", () => {
        expect(new Set(settingsRegistry.map((entry) => entry.id)).size).toBe(settingsRegistry.length);
        for (const section of settingsSections)
            expect(settingsRegistry.some((entry) => entry.section === section.id)).toBe(true);
    });
    test.each(["phone", "tablet", "tv"] as const)("omits desktop Big Picture and shortcut hints on %s", (device) => {
        expect(ids(device)).not.toContain("tv-mode");
        expect(
            filterSettings({ ...context, device }).some((entry) =>
                /⇧T|arrow-key|keyboard shortcut/i.test(`${entry.label} ${entry.description}`)
            )
        ).toBe(false);
    });
    test("shows Big Picture on desktop", () => expect(ids("desktop")).toContain("tv-mode"));
    test.each(["phone", "tablet", "desktop", "tv"] as const)(
        "keeps sync, caches and recovery controls on %s",
        (device) => {
            const visible = ids(device);
            for (const id of [
                "device-sync",
                "device-override",
                "links-cache",
                "all-cache",
                "watch-history",
                "search-history",
                "media-player",
            ])
                expect(visible).toContain(id);
        }
    );
    test("gates TorBox against the active provider", () => {
        expect(filterSettings(context).map((entry) => entry.id)).not.toContain("torbox");
        expect(filterSettings({ ...context, isTorbox: true }).map((entry) => entry.id)).toContain("torbox");
    });
    test("Trakt connect remains discoverable when disconnected", () => expect(ids("phone")).toContain("trakt"));
    test("requires gates work independently and compose with device filtering", () => {
        const base = settingsRegistry[0];
        const entries: SettingEntry[] = [
            { ...base, id: "trakt-required", requires: "trakt", devices: ["desktop"] },
            { ...base, id: "torbox-required", requires: "torbox", devices: ["desktop"] },
            { ...base, id: "always", devices: ["desktop", "phone"] },
        ];
        expect(filterSettings(context, "", entries).map((entry) => entry.id)).toEqual(["always"]);
        expect(filterSettings({ ...context, isTraktConnected: true }, "", entries).map((entry) => entry.id)).toEqual([
            "trakt-required",
            "always",
        ]);
        expect(filterSettings({ ...context, isTorbox: true }, "", entries).map((entry) => entry.id)).toEqual([
            "torbox-required",
            "always",
        ]);
        expect(
            filterSettings({ device: "phone", isTorbox: true, isTraktConnected: true }, "", entries).map(
                (entry) => entry.id
            )
        ).toEqual(["always"]);
    });
    test("search matches labels and descriptions without bypassing gating", () => {
        expect(filterSettings(context, "  SUBTITLE LANGUAGE  ").map((entry) => entry.id)).toEqual([
            "subtitle-language",
        ]);
        expect(filterSettings(context, "frame-rate drift").map((entry) => entry.id)).toEqual(["subtitle-auto-sync"]);
        expect(filterSettings(context, "TorBox")).toEqual([]);
        expect(filterSettings({ ...context, device: "phone" }, "Big Picture")).toEqual([]);
    });
    test("scope follows profile preferences and shared account integrations", () => {
        const scope = (id: string) => settingsRegistry.find((entry) => entry.id === id)?.scope;
        expect(scope("subtitle-auto-sync")).toBe("device");
        expect(scope("auto-resume")).toBe("profile");
        expect(scope("media-player")).toBe("device");
        expect(scope("device-sync")).toBe("device");
        expect(scope("tmdb")).toBe("account");
        expect(scope("trakt")).toBe("profile");
    });
});
