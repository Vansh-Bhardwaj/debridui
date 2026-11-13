/**
 * One place that decides how this device plays video.
 *
 * - "native": iPhone / iPad use Apple's player for originals and provider HLS.
 * - "custom": desktop / Android use the in-page player, with native HLS on
 *   Safari and hls.js elsewhere. The playback mode chooses the media on both.
 */
import { getCodecSupport, isIOS, type CodecSupport } from "@/lib/utils/codec-support";
import { codecLabel, normalizeCodec, type StreamInfo } from "@/lib/streaming/stream-info";

export type DeviceKind = "iphone" | "ipad" | "android" | "mac" | "desktop";
export type BrowserEngine = "webkit" | "chromium" | "gecko";

export interface DeviceProfile {
    kind: DeviceKind;
    engine: BrowserEngine;
    /** e.g. "iPhone · Safari" */
    label: string;
    route: "native" | "custom";
    /** Can the browser open Matroska (MKV) files at all? */
    mkv: boolean;
    /** How HLS plays here: Apple's built-in support or hls.js over MediaSource. */
    hls: "native" | "hlsjs" | "none";
    codecs: CodecSupport;
}

const KIND_LABEL: Record<DeviceKind, string> = { iphone: "iPhone", ipad: "iPad", android: "Android", mac: "Mac", desktop: "Desktop" };

function canPlay(type: string): boolean {
    return !!document.createElement("video").canPlayType(type);
}

function browserName(ua: string): string {
    if (/Edg/i.test(ua)) return "Edge";
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/Firefox|FxiOS/i.test(ua)) return "Firefox";
    if (/Chrome|CriOS/i.test(ua)) return "Chrome";
    return "Safari";
}

function detect(): DeviceProfile {
    const ua = navigator.userAgent;
    const ios = isIOS();
    const kind: DeviceKind = ios
        ? /iPhone|iPod/.test(ua) ? "iphone" : "ipad"
        : /Android/i.test(ua) ? "android" : /Macintosh/.test(ua) ? "mac" : "desktop";
    // Every iOS browser is WebKit underneath.
    const engine: BrowserEngine = ios || (!/Chrome|Chromium|Edg|Firefox/i.test(ua) && /Safari/i.test(ua))
        ? "webkit"
        : /Firefox/i.test(ua) ? "gecko" : "chromium";
    const nativeHls = canPlay("application/vnd.apple.mpegurl");
    const mse = !!window.MediaSource?.isTypeSupported?.('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')
        || "ManagedMediaSource" in window;
    return {
        kind,
        engine,
        label: `${KIND_LABEL[kind]} · ${browserName(ua)}`,
        route: ios ? "native" : "custom",
        // Chromium plays MKV without advertising it; WebKit never opens it.
        mkv: engine === "chromium" || (engine === "gecko" && canPlay("video/x-matroska")),
        // Safari's own HLS beats hls.js there; elsewhere hls.js exposes every audio track.
        hls: engine === "webkit" && nativeHls ? "native" : mse ? "hlsjs" : nativeHls ? "native" : "none",
        codecs: getCodecSupport(),
    };
}

let cached: DeviceProfile | null = null;
/** Client-only; returns null during SSR. */
export function getDeviceProfile(): DeviceProfile | null {
    if (typeof navigator === "undefined" || typeof document === "undefined") return null;
    return (cached ??= detect());
}

const MP4_FAMILY = /\.(mp4|m4v|mov)$/i;
const CONTAINER = /\.(mkv|mp4|m4v|mov|avi|webm|wmv|flv|ts)(?=$|[?#\s\])])/i;

/** Container extension from the first candidate (file name, release title, URL) that has one. */
export function detectContainer(...candidates: (string | undefined)[]): string | null {
    for (const value of candidates) {
        if (!value) continue;
        let text = value;
        try {
            text = decodeURIComponent(new URL(value).pathname);
        } catch {
            /* not a URL */
        }
        const ext = text.match(CONTAINER)?.[1];
        if (ext) return ext.toLowerCase();
    }
    return null;
}

export function isMp4Family(container: string | null): boolean {
    return !!container && MP4_FAMILY.test(`.${container}`);
}

/**
 * Why the original file can't play on this device, or null if it should.
 * Unknown container/codecs count as playable except on WebKit, which fails on
 * anything but MP4-family files.
 */
export function getOriginalIssue(profile: DeviceProfile, container: string | null, info?: StreamInfo | null): string | null {
    const browser = profile.label.split(" · ")[1] ?? "This browser";
    if (container && !isMp4Family(container)) {
        const opens = container === "webm" ? profile.engine !== "webkit" : container === "mkv" ? profile.mkv : false;
        if (!opens) return `${browser} can't open ${container.toUpperCase()} files`;
    } else if (!container && profile.engine === "webkit") {
        return `${browser} only plays MP4 files directly`;
    }
    if (!info) return null;
    const support = profile.codecs as unknown as Record<string, boolean>;
    const audio = info.audios.find((a) => a.index === info.audioIndex) ?? info.audios[0];
    const blocked = [normalizeCodec(info.videoCodec), normalizeCodec(audio?.codec)].filter(
        (c): c is string => !!c && c in support && !support[c]
    );
    return blocked.length ? `${browser} can't decode ${blocked.map(codecLabel).join(" + ")}` : null;
}
