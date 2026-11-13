import { afterEach, describe, expect, test } from "bun:test";
import { enterNativeFullscreen, type NativeFullscreenVideo } from "../lib/playback/native-fullscreen";
import { decideStream, isIOS } from "../lib/utils/codec-support";
import { MediaPlayer, Platform } from "../lib/types";
import { subtitleToVideoTime, videoToSubtitleTime, type SubtitleSyncState } from "../lib/utils/subtitle-sync";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, "navigator");
});

describe("iOS native playback", () => {
    test("requests Apple's fullscreen synchronously in the tap handler", () => {
        const calls: string[] = [];
        const video = { webkitEnterFullscreen: () => calls.push("fullscreen") } as unknown as NativeFullscreenVideo;
        expect(enterNativeFullscreen(video)).toBe(true);
        calls.push("handler returned");
        expect(calls).toEqual(["fullscreen", "handler returned"]);
    });

    test("allows fallback when native fullscreen is missing or rejects before metadata", () => {
        expect(enterNativeFullscreen({} as NativeFullscreenVideo)).toBe(false);
        const video = { webkitEnterFullscreen: () => { throw new Error("Not ready"); } } as unknown as NativeFullscreenVideo;
        expect(enterNativeFullscreen(video)).toBe(false);
    });

    test("recognizes iPad desktop mode without classifying a Mac as iOS", () => {
        const userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15";
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent, maxTouchPoints: 5 } });
        expect(isIOS()).toBe(true);
        Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent, maxTouchPoints: 0 } });
        expect(isIOS()).toBe(false);
    });

    test("platform detection recovers after SSR and uses iOS player options on iPad", async () => {
        Reflect.deleteProperty(globalThis, "navigator");
        const { detectPlatform, isMobileOrTablet, isSupportedPlayer } = await import("../lib/utils/media-player");
        expect(detectPlatform()).toBe(Platform.UNKNOWN);
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15", maxTouchPoints: 5 },
        });
        expect(detectPlatform()).toBe(Platform.IOS);
        expect(isMobileOrTablet()).toBe(true);
        expect(isSupportedPlayer(MediaPlayer.INFUSE)).toBe(true);
        expect(isSupportedPlayer(MediaPlayer.IINA)).toBe(false);
    });
});

describe("native caption timing", () => {
    const states: SubtitleSyncState[] = [
        { delayMs: 0, speed: 1 },
        { delayMs: 1500, speed: 1.04 },
        { delayMs: -500, speed: 0.96, pointA: { videoAt: 100, subAt: 90 } },
        { delayMs: 750, speed: 1.02, pointA: { videoAt: 100, subAt: 90 }, pointB: { videoAt: 400, subAt: 380 } },
        { delayMs: 0, speed: 1, pointB: { videoAt: 100, subAt: 90 }, pointA: { videoAt: 400, subAt: 380 } },
    ];
    for (const [index, state] of states.entries()) {
        test(`matches custom subtitle timing for sync configuration ${index}`, () => {
            for (const time of [0, 50, 100, 250, 400, 600]) {
                expect(subtitleToVideoTime(videoToSubtitleTime(time, state), state)).toBeCloseTo(time, 8);
            }
        });
    }
});


describe("iOS playback mode respects the original container", () => {
    test("native tries the original MKV while fallback waits for a converted stream", () => {
        const profile = { kind: "iphone", engine: "webkit", route: "native", label: "iPhone · Safari", mkv: false,
            hls: "native", codecs: {} } as import("../lib/playback/device-profile").DeviceProfile;
        const input = { downloadUrl: "https://cdn/movie.mkv", fileName: "movie.mkv", profile };
        expect(decideStream({ ...input, engine: "native" }).url).toBe(input.downloadUrl);
        expect(decideStream({ ...input, engine: "fallback" }).url).toBe("");
        expect(decideStream({ ...input, engine: "fallback", streamingLinks: { apple: "https://cdn/hls" } }).url).toBe("https://cdn/hls");
    });
});
