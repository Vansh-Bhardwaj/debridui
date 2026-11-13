import { describe, expect, test } from "bun:test";
import { extractHash, parseStream } from "../lib/addons/parser";
import { detectContainer, getOriginalIssue, type DeviceProfile } from "../lib/playback/device-profile";
import { pickPreferredAudio, type StreamInfo } from "../lib/streaming/stream-info";
import { parseSubtitleCues } from "../lib/utils/subtitles";
import { decideStream, migratePlaybackMode, type PlaybackEngine, type CodecSupport } from "../lib/utils/codec-support";
import { selectBestSource } from "../lib/streaming/source-selector";
import { Resolution, SourceQuality, type AddonSource } from "../lib/addons/types";
import { migrateStreamingSettings, type StreamingSettings } from "../lib/stores/settings";
import { playbackEngine, playbackRankingOptions } from "../lib/playback/preferences";

const HASH = "59fc622486a1b2c3d4e5f60718293a4b5c6d7e8f";
const allCodecs = (overrides: Partial<CodecSupport> = {}): CodecSupport => ({
    h264: true, hevc: true, vp9: true, av1: true, hdr: false, aac: true, ac3: true, eac3: true,
    dts: false, opus: true, flac: true, mp3: true, truehd: false, ...overrides,
});
const iphone: DeviceProfile = { kind: "iphone", engine: "webkit", label: "iPhone · Safari", route: "native", mkv: false, hls: "native", codecs: allCodecs() };
const chrome: DeviceProfile = { kind: "desktop", engine: "chromium", label: "Desktop · Chrome", route: "custom", mkv: true, hls: "hlsjs", codecs: allCodecs({ ac3: false, eac3: false }) };
const info = (audios: { codec: string; language: string }[], audioIndex = 0) =>
    ({ videoCodec: "h264", audios: audios.map((a, index) => ({ index, ...a })), audioIndex }) as unknown as StreamInfo;

describe("addon source → debrid library hints", () => {
    test("reads the info hash from debrid-configured resolve URLs", () => {
        expect(extractHash({ url: `https://torrentio.strem.fun/resolve/torbox/KEY/${HASH}/null/3/Friends.S03E01.mkv` })).toBe(HASH);
        expect(extractHash({ url: `https://mf.example/stream?info_hash=${HASH.toUpperCase()}&x=1` })).toBe(HASH);
        expect(extractHash({ url: "https://cdn.example/dl/abc/Friends.mkv" })).toBeUndefined();
    });

    test("keeps the exact file name and size from behaviorHints", () => {
        const source = parseStream(
            { name: "TB", url: "https://x/y", behaviorHints: { filename: "Friends.S03E01.mkv", videoSize: 3_640_000_000 } },
            "a", "Addon"
        );
        expect(source.fileName).toBe("Friends.S03E01.mkv");
        expect(source.videoSize).toBe(3_640_000_000);
    });
});

describe("per-device playability", () => {
    test("detects the container from names and URLs", () => {
        expect(detectContainer(undefined, "Friends S03 E01 [2160p]", "https://cdn/x/Friends.S03E01.mkv?token=1")).toBe("mkv");
        expect(detectContainer("Show.S01E01.MP4")).toBe("mp4");
        expect(detectContainer("How I Met Your Mother S04E11")).toBeNull();
    });

    test("iPhone never plays MKV or unknown files directly", () => {
        expect(getOriginalIssue(iphone, "mkv")).toContain("can't open MKV");
        expect(getOriginalIssue(iphone, null)).not.toBeNull();
        expect(getOriginalIssue(iphone, "mp4")).toBeNull();
        expect(getOriginalIssue(iphone, "mp4", info([{ codec: "truehd", language: "eng" }]))).toContain("TrueHD");
    });

    test("Chrome plays MKV but not Dolby audio it can't decode", () => {
        expect(getOriginalIssue(chrome, "mkv")).toBeNull();
        expect(getOriginalIssue(chrome, null)).toBeNull();
        expect(getOriginalIssue(chrome, "mkv", info([{ codec: "eac3", language: "eng" }]))).not.toBeNull();
    });
});

describe("audio language for the converted stream", () => {
    const dubbedFirst = info([{ codec: "eac3", language: "Hungarian" }, { codec: "eac3", language: "English" }]);

    test("switches away from a dub to the preferred language", () => {
        expect(pickPreferredAudio(dubbedFirst, "english")).toBe(1);
        expect(pickPreferredAudio(info([{ codec: "aac", language: "hun" }, { codec: "aac", language: "eng" }]), "english")).toBe(1);
    });

    test("keeps the current track when it already matches or nothing matches", () => {
        expect(pickPreferredAudio({ ...dubbedFirst, audioIndex: 1 }, "english")).toBeNull();
        expect(pickPreferredAudio(dubbedFirst, "japanese")).toBeNull();
        expect(pickPreferredAudio(dubbedFirst, "")).toBeNull();
    });
});

describe("subtitle parsing", () => {
    test("parses SRT and WebVTT", () => {
        const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:01:00,000 --> 00:01:01,000\r\nWorld";
        expect(parseSubtitleCues(srt)).toEqual([
            { start: 1, end: 2.5, text: "Hello" },
            { start: 60, end: 61, text: "World" },
        ]);
        expect(parseSubtitleCues("WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHi")).toEqual([{ start: 1, end: 2, text: "Hi" }]);
    });
});

describe("auto-select on devices that can't open MKV", () => {
    const settings = {
        profileId: "custom",
        customRange: { minResolution: Resolution.SD_480P, maxResolution: "any", minSourceQuality: SourceQuality.WEBRIP, maxSourceQuality: SourceQuality.BLURAY },
        preferCached: true,
        skipCamReleases: true,
        rememberFailedSources: false,
    } as unknown as StreamingSettings;
    const source = (fileName: string, resolution: Resolution): AddonSource => ({
        title: "Addon", description: fileName, fileName, resolution, quality: SourceQuality.BLURAY,
        url: `https://x/${fileName}`, isCached: true, addonId: "a", addonName: "Addon",
    });
    const mkv4k = source("Friends.S03E01.2160p.BluRay.H.264.AAC.mkv", Resolution.UHD_4K);
    const mp4720 = source("Friends.S03E01.720p.BluRay.H.264.AAC.mp4", Resolution.HD_720P);
    const safari = allCodecs();

    test("keeps the best MKV when the provider converts it", () => {
        const result = selectBestSource([mp4720, mkv4k], settings, { codecSupport: safari, mkvPlayable: false, transcodeAvailable: true });
        expect(result.source?.fileName).toBe(mkv4k.fileName);
    });

    test("doesn't let the MKV container cost it a quality tier when converted", () => {
        const mp4Web = { ...source("Friends.S03E01.2160p.WEB-DL.H.264.AAC.mp4", Resolution.UHD_4K), quality: SourceQuality.WEB_DL };
        const result = selectBestSource([mp4Web, mkv4k], settings, { codecSupport: safari, mkvPlayable: false, transcodeAvailable: true });
        expect(result.source?.fileName).toBe(mkv4k.fileName);
    });

    test("prefers a playable MP4 when nothing converts the MKV", () => {
        const result = selectBestSource([mkv4k, mp4720], settings, { codecSupport: safari, mkvPlayable: false, transcodeAvailable: false });
        expect(result.source?.fileName).toBe(mp4720.fileName);
    });
});

describe("auto-select on desktop browsers (Edge/Chrome)", () => {
    const settings = {
        profileId: "custom",
        customRange: { minResolution: Resolution.SD_480P, maxResolution: "any", minSourceQuality: SourceQuality.WEBRIP, maxSourceQuality: SourceQuality.BLURAY_REMUX },
        preferCached: true,
        skipCamReleases: true,
        rememberFailedSources: false,
    } as unknown as StreamingSettings;
    const src = (fileName: string, resolution: Resolution, quality: SourceQuality): AddonSource => ({
        title: "Addon", description: fileName, fileName, resolution, quality,
        url: `https://x/${fileName}`, isCached: true, addonId: "a", addonName: "Addon",
    });

    test("plays what the browser decodes before a file that needs conversion", () => {
        const dts4k = src("Movie.2160p.BluRay.REMUX.HEVC.DTS-HD.MA.mkv", Resolution.UHD_4K, SourceQuality.BLURAY_REMUX);
        const aac1080 = src("Movie.1080p.WEB-DL.H.264.AAC.mkv", Resolution.FHD_1080P, SourceQuality.WEB_DL);
        // Desktop ranking never treats conversion as equal (rankAsConverted is iPhone/iPad only).
        const result = selectBestSource([dts4k, aac1080], settings, { codecSupport: allCodecs({ dts: false }), transcodeAvailable: false });
        expect(result.source?.fileName).toBe(aac1080.fileName);
    });
});

describe("subtitles inside the iPhone stream", () => {
    const sub = (lang: string, n: number) => ({ url: `https://subs/${lang}/${n}`, lang });

    test("several in the preferred language, one per other language", async () => {
        const { pickNativeSubtitles } = await import("../lib/playback/native-hls");
        const list = [sub("eng", 1), sub("eng", 2), sub("spa", 1), sub("eng", 3), sub("spa", 2), sub("eng", 4), sub("eng", 5), sub("fre", 1)];
        expect(pickNativeSubtitles(list, "english").map((s) => s.url)).toEqual([
            "https://subs/eng/1", "https://subs/eng/2", "https://subs/eng/3", "https://subs/eng/4", "https://subs/spa/1", "https://subs/fre/1",
        ]);
    });

    test("every track gets a distinct name so Apple's menu can select it", async () => {
        const { nativeSubtitleNames } = await import("../lib/playback/native-hls");
        const names = nativeSubtitleNames([sub("eng", 1), sub("eng", 2), sub("spa", 1), sub("eng", 3)]);
        expect(names).toEqual(["English", "English 2", "Spanish", "English 3"]);
        expect(new Set(names).size).toBe(names.length);
    });
});


describe("playback modes", () => {
    const original = "https://cdn/movie.mkv";
    const hls = "https://cdn/stream.m3u8";
    const metadata = info([{ codec: "dts", language: "eng" }]);
    for (const profile of [iphone, chrome, { ...chrome, kind: "android", label: "Android · Chrome" } as DeviceProfile,
        { ...iphone, kind: "mac", route: "custom", label: "Mac · Safari" } as DeviceProfile]) {
        test(`${profile.label}: strict native never selects HLS, even for unsupported codecs`, () => {
            expect(decideStream({ downloadUrl: original, streamingLinks: { apple: hls }, fileName: "movie.mkv",
                info: metadata, profile, engine: "native" }).url).toBe(original);
        });
        test(`${profile.label}: fallback selects HLS for DTS`, () => {
            expect(decideStream({ downloadUrl: original, streamingLinks: { apple: hls }, fileName: "movie.mkv",
                info: metadata, profile, engine: "fallback" }).url).toBe(hls);
        });
        test(`${profile.label}: playable MP4 stays original in fallback`, () => {
            expect(decideStream({ downloadUrl: original, streamingLinks: { apple: hls }, fileName: "movie.mp4",
                info: info([{ codec: "aac", language: "eng" }]), profile, engine: "fallback" }).url).toBe(original);
        });
        test(`${profile.label}: transcode always selects HLS, even for a playable MP4`, () => {
            expect(decideStream({ downloadUrl: original, streamingLinks: { apple: hls }, fileName: "movie.mp4",
                profile, engine: "transcode" }).url).toBe(hls);
        });
    }
    test("transcode without HLS never silently plays the original or another converted format", () => {
        for (const streamingLinks of [undefined, {}, { liveMP4: "https://cdn/transcoded.mp4" }]) {
            const result = decideStream({ downloadUrl: original, fileName: "movie.mp4", engine: "transcode", streamingLinks, profile: chrome });
            expect(result.url).toBe("");
            expect(result.reason).toContain("account/plan");
        }
    });
    test("migrates legacy profile modes and keeps device audio conversion as an advanced option", () => {
        for (const [old, mode] of [["original", "native"], ["auto", "fallback"], ["compatible", "transcode"], ["device", "fallback"]]) {
            expect(migratePlaybackMode(old)).toBe(mode);
            const migrated = migrateStreamingSettings({ playbackEngine: old } as unknown as StreamingSettings);
            expect(migrated.playbackEngine).toBe(mode);
            expect(migrated.deviceAudioRemux).toBe(old === "device");
        }
    });
    test("device override wins over profile, and advanced remux is only used for fallback", () => {
        const settings = { playbackEngine: "native", deviceAudioRemux: true } as StreamingSettings;
        expect(playbackEngine(settings, null)).toBe("native");
        expect(playbackEngine(settings, "transcode")).toBe("transcode");
        expect(playbackEngine(settings, "fallback")).toBe("device");
    });
});

describe("mode-aware source ranking", () => {
    const settings = {
        profileId: "max-quality", preferCached: true, allowUncached: true, rememberFailedSources: false,
    } as StreamingSettings;
    const source = (name: string, resolution: Resolution): AddonSource => ({
        title: name, fileName: name, url: `https://cdn/${name}`, addonId: "test", addonName: "Test",
        resolution, quality: SourceQuality.BLURAY, isCached: true,
    });
    const dts4k = source("Movie.HEVC.DTS.mkv", Resolution.UHD_4K);
    const aac720 = source("Movie.H264.AAC.mp4", Resolution.HD_720P);
    for (const profile of [iphone, chrome]) {
        test(`${profile.label}: native penalizes unsupported codecs even with provider transcode`, () => {
            const options = playbackRankingOptions("native", profile, true);
            expect(selectBestSource([dts4k, aac720], settings, options).source).toBe(aac720);
        });
        test(`${profile.label}: transcode ignores codecs with or without plan capability`, () => {
            for (const available of [true, false]) {
                const options = playbackRankingOptions("transcode", profile, available);
                expect(selectBestSource([aac720, dts4k], settings, options).source).toBe(dts4k);
            }
        });
    }
    test("transcode ranks known availability above original quality", () => {
        const options = { ...playbackRankingOptions("transcode", chrome, true),
            sourceTranscodeAvailable: (s: AddonSource) => s === aac720 };
        expect(selectBestSource([dts4k, aac720], settings, options).source).toBe(aac720);
    });
    test("transcode ignores an accidentally supplied codec penalty", () => {
        expect(selectBestSource([dts4k, aac720], settings, {
            codecSupport: chrome.codecs, transcodeOnly: true,
        }).source).toBe(dts4k);
    });
    test("fallback keeps desktop native preference and allows iPhone conversion", () => {
        expect(playbackRankingOptions("fallback" as PlaybackEngine, chrome, true).transcodeAvailable).toBe(false);
        expect(playbackRankingOptions("fallback", iphone, true).transcodeAvailable).toBe(true);
    });
});


describe("locked playback source", () => {
    test("blocks every automatic next-source request after playback starts, even with the old toggle off", async () => {
        const { useStreamingStore } = await import("../lib/stores/streaming");
        const { useSettingsStore } = await import("../lib/stores/settings");
        const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
            getItem: () => null, setItem: () => {}, removeItem: () => {},
        } });
        const snapshot = useStreamingStore.getState();
        const settings = useSettingsStore.getState().get("streaming");
        const sources = ["first", "second"].map((name) => ({ title: name, url: `https://cdn/${name}`,
            addonId: "test", addonName: "Test" }) as AddonSource);
        const switched: AddonSource[] = [];
        try {
            useSettingsStore.getState().set("streaming", { ...settings, lockSourceAfterStart: false, rememberFailedSources: false });
            useStreamingStore.setState({ allFetchedSources: sources, selectedSource: sources[0], playbackStarted: false,
                playAlternativeSource: (source) => { switched.push(source); } });
            useStreamingStore.getState().markPlaybackStarted();
            expect(useStreamingStore.getState().playNextBestSource()).toBe(false);
            expect(switched).toHaveLength(0);
            expect(useStreamingStore.getState().playNextBestSource(true)).toBe(true);
            expect(switched).toEqual([sources[1]]);
        } finally {
            useStreamingStore.setState(snapshot);
            useSettingsStore.getState().set("streaming", settings);
            if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
            else Reflect.deleteProperty(globalThis, "localStorage");
        }
    });
});


test("source transcode availability follows provider lookup results and resets with the account", async () => {
    const { setProviderTranscodeAvailable, setStreamLinkLookup, prefetchStreamLinks, sourceTranscodeAvailable } =
        await import("../lib/streaming/stream-info");
    const source = { url: "https://addon/movie", fileName: "movie.mkv" } as AddonSource;
    try {
        setProviderTranscodeAvailable(true);
        setStreamLinkLookup(async () => ({ apple: "https://cdn/hls" }));
        expect(sourceTranscodeAvailable(source)).toBeUndefined();
        prefetchStreamLinks(source);
        await Promise.resolve();
        expect(sourceTranscodeAvailable(source)).toBe(true);
        setStreamLinkLookup(async () => ({}));
        expect(sourceTranscodeAvailable(source)).toBeUndefined();
        prefetchStreamLinks(source);
        await Promise.resolve();
        expect(sourceTranscodeAvailable(source)).toBe(false);
    } finally {
        setStreamLinkLookup(null);
        setProviderTranscodeAvailable(false);
    }
});
