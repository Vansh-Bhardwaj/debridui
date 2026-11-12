/**
 * Provider stream sessions (currently TorBox `stream/createstream`).
 *
 * The provider returns an HLS url plus the file's real codec metadata, so the
 * player can decide "direct vs compatible stream" from facts instead of
 * guessing from the filename, and can offer audio-track / quality switching
 * that the provider transcodes for us (no Cloudflare or device cost).
 */

import type { AddonSource } from "@/lib/addons/types";
import type { StreamHint } from "@/lib/clients/base";
import { getLanguageDisplayName } from "@/lib/utils/subtitles";

export interface StreamAudio {
    /** Relative index the provider expects when choosing this track. */
    index: number;
    codec: string;
    language?: string;
    title?: string;
    channels?: number;
    isDefault?: boolean;
}

export interface StreamVariantOptions {
    audioIndex?: number;
    /** null = original resolution. */
    resolutionIndex?: number | null;
}

export interface StreamResolution {
    /** Provider resolution index, null = original. */
    index: number | null;
    label: string;
    height: number | null;
}

export interface StreamInfo {
    provider: "torbox";
    hlsUrl: string;
    videoCodec?: string;
    width?: number;
    height?: number;
    audios: StreamAudio[];
    audioIndex: number;
    resolutionIndex: number | null;
    resolutions: StreamResolution[];
    needsTranscoding?: boolean;
    /** Create a new HLS session with a different audio track / resolution. */
    switchVariant: (opts: StreamVariantOptions) => Promise<StreamInfo | null>;
}

/**
 * Whether the active debrid account can transcode on demand (TorBox Pro web
 * streaming). When true, codec-incompatible releases are still playable, so
 * source ranking stops filtering them out. Set by the auth provider.
 */
let providerTranscode = false;
export const setProviderTranscodeAvailable = (value: boolean) => {
    providerTranscode = value;
};
export const isProviderTranscodeAvailable = () => providerTranscode;

/**
 * Provider index of the audio track in the user's language ("english" or "eng"),
 * or null when the current track already matches / nothing matches.
 */
export function pickPreferredAudio(info: Pick<StreamInfo, "audios" | "audioIndex">, language?: string): number | null {
    const want = language?.trim().toLowerCase();
    if (!want) return null;
    const matches = (a: StreamAudio) => {
        const lang = (a.language ?? "").toLowerCase();
        return lang === want || lang.startsWith(want) || (lang.length === 3 && lang === getLanguageDisplayName(want).toLowerCase())
            || getLanguageDisplayName(lang).toLowerCase() === want;
    };
    const current = info.audios.find((a) => a.index === info.audioIndex);
    if (current && matches(current)) return null;
    return info.audios.find(matches)?.index ?? null;
}

/** Video file name at the end of an addon resolve URL (Torrentio-style), if any. */
function videoNameFromUrl(url: string | undefined): string | undefined {
    try {
        const name = decodeURIComponent(new URL(url ?? "").pathname.split("/").pop() ?? "");
        return /\.(mkv|mp4|m4v|avi|mov|webm|ts)$/i.test(name) ? name : undefined;
    } catch {
        return undefined;
    }
}

/** What a debrid client needs to find an addon source's file in the user's library. */
export function sourceStreamHint(
    source: AddonSource | null | undefined,
    episode?: { season?: number | null; episode?: number | null } | null
): StreamHint {
    return {
        infoHash: source?.magnet?.match(/btih:([a-f0-9]{40})/i)?.[1],
        fileName: source?.fileName ?? videoNameFromUrl(source?.url),
        fileSize: source?.videoSize,
        season: episode?.season ?? undefined,
        episode: episode?.episode ?? undefined,
    };
}

type StreamLinkLookup = (url: string, hint: StreamHint) => Promise<Record<string, string>>;
let streamLinkLookup: StreamLinkLookup | null = null;
/** Registered by the auth provider for the active debrid account. */
export const setStreamLinkLookup = (lookup: StreamLinkLookup | null) => {
    streamLinkLookup = lookup;
};

/**
 * Start the provider stream lookup as soon as a source is picked, in parallel with
 * resolving the addon URL. The client caches the result, so the player's own lookup
 * reuses it — this removes most of the wait before iOS can start playback.
 */
export function prefetchStreamLinks(source: AddonSource, episode?: { season?: number | null; episode?: number | null } | null): void {
    if (!providerTranscode || !streamLinkLookup) return;
    const hint = sourceStreamHint(source, episode);
    if (hint.infoHash || hint.fileName || hint.fileSize) void streamLinkLookup(source.url ?? "", hint).catch(() => {});
}

const registry = new Map<string, StreamInfo>();
const MAX_ENTRIES = 50;

export function registerStreamInfo(info: StreamInfo): void {
    registry.set(info.hlsUrl, info);
    if (registry.size > MAX_ENTRIES) {
        const oldest = registry.keys().next().value;
        if (oldest) registry.delete(oldest);
    }
}

export function getStreamInfo(hlsUrl: string | undefined): StreamInfo | undefined {
    return hlsUrl ? registry.get(hlsUrl) : undefined;
}

/** Normalize provider/ffprobe codec names to the keys used by CodecSupport. */
export function normalizeCodec(codec: string | undefined): string {
    const c = (codec ?? "").toLowerCase();
    if (c.includes("truehd") || c === "mlp") return "truehd";
    if (c.startsWith("dts") || c.startsWith("dca")) return "dts";
    if (c === "eac3" || c === "e-ac-3" || c === "ec-3") return "eac3";
    if (c === "ac3" || c === "ac-3") return "ac3";
    if (c === "aac") return "aac";
    if (c === "opus") return "opus";
    if (c === "flac") return "flac";
    if (c === "mp3" || c === "mp2") return "mp3";
    if (c === "hevc" || c === "h265") return "hevc";
    if (c === "h264" || c === "avc" || c === "avc1") return "h264";
    if (c === "av1") return "av1";
    if (c === "vp9") return "vp9";
    return c;
}

const CODEC_LABELS: Record<string, string> = {
    truehd: "TrueHD",
    dts: "DTS",
    eac3: "Dolby Digital+",
    ac3: "Dolby Digital",
    aac: "AAC",
    opus: "Opus",
    flac: "FLAC",
    mp3: "MP3",
    hevc: "HEVC",
    h264: "H.264",
    av1: "AV1",
    vp9: "VP9",
};

export function codecLabel(codec: string | undefined): string {
    const key = normalizeCodec(codec);
    return CODEC_LABELS[key] ?? (codec ? codec.toUpperCase() : "Unknown");
}

export function channelLabel(channels: number | undefined): string {
    if (!channels) return "";
    if (channels === 1) return "Mono";
    if (channels === 2) return "Stereo";
    if (channels === 6) return "5.1";
    if (channels === 8) return "7.1";
    return `${channels}ch`;
}
