/**
 * Browser codec support detection utilities
 * Helps determine which audio/video formats can be played natively
 */

import { detectContainer, getDeviceProfile, getOriginalIssue, type DeviceProfile } from "@/lib/playback/device-profile";
import { codecLabel, normalizeCodec, type StreamInfo } from "@/lib/streaming/stream-info";

export interface CodecSupport {
    h264: boolean;
    hevc: boolean;
    vp9: boolean;
    av1: boolean;
    hdr: boolean;
    aac: boolean;
    ac3: boolean;
    eac3: boolean;
    dts: boolean;
    opus: boolean;
    flac: boolean;
    mp3: boolean;
    truehd: boolean;
}

const HDR_MARKER_REGEX = /(?:\b(?:hdr10\+?|hdr|hlg|pq|dolby[\s.-]?vision|bt\.?2020|rec\.?2020)\b|\bdv\b)/i;

/**
 * Check if we're on iOS (including iPadOS 13+ which uses a macOS user agent)
 */
export function isIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    // Standard iOS detection
    if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
    // iPadOS 13+ sends macOS UA but has touch support
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
    return false;
}

/**
 * Check if we're on Safari (including iOS Safari)
 */
export function isSafari(): boolean {
    if (typeof navigator === "undefined") return false;
    return /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
}

/**
 * Check if the browser supports a specific MIME type
 */
function canPlayType(mimeType: string): boolean {
    if (typeof document === "undefined") return false;
    const video = document.createElement("video");
    const result = video.canPlayType(mimeType);
    return result === "probably" || result === "maybe";
}

/**
 * Browser-level HDR rendering capability check (best effort).
 * Requires both an HDR-capable display signal and at least one 10-bit HDR video profile.
 */
function supportsBrowserHdrPlayback(): boolean {
    if (typeof window === "undefined") return false;

    const hasHdrDisplay =
        window.matchMedia?.("(dynamic-range: high)")?.matches ||
        window.matchMedia?.("(video-dynamic-range: high)")?.matches ||
        false;

    const hevcMain10 =
        canPlayType('video/mp4; codecs="hvc1.2.4.L153.B0"') ||
        canPlayType('video/mp4; codecs="hev1.2.4.L153.B0"');
    const vp9Profile2 = canPlayType('video/webm; codecs="vp09.02.10.10"');
    const av1Main10 = canPlayType('video/mp4; codecs="av01.0.10M.10"');

    return hasHdrDisplay && (hevcMain10 || vp9Profile2 || av1Main10);
}

/**
 * Heuristic detection for HDR source naming in release titles and URLs.
 */
function isLikelyHdrSource(filename: string, downloadUrl?: string): boolean {
    const haystack = `${filename} ${downloadUrl ?? ""}`.toLowerCase();
    return HDR_MARKER_REGEX.test(haystack);
}

/**
 * Detect browser codec support
 * Note: This is a best-effort detection and may not be 100% accurate
 */
export function detectCodecSupport(): CodecSupport {
    return {
        // Video codecs
        h264: canPlayType('video/mp4; codecs="avc1.42E01E"'),
        hevc: canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') || canPlayType('video/mp4; codecs="hev1.1.6.L120.90"'),
        vp9: canPlayType('video/webm; codecs="vp9"'),
        av1: canPlayType('video/mp4; codecs="av01.0.05M.08"'),
        hdr: supportsBrowserHdrPlayback(),
        
        // Audio codecs
        aac: canPlayType('audio/mp4; codecs="mp4a.40.2"'),
        ac3: canPlayType('audio/mp4; codecs="ac-3"'),
        eac3: canPlayType('audio/mp4; codecs="ec-3"') || canPlayType('audio/mp4; codecs="eac3"'),
        dts: canPlayType('audio/mp4; codecs="dts"') || canPlayType('audio/mp4; codecs="dtsc"'),
        opus: canPlayType('audio/webm; codecs="opus"'),
        flac: canPlayType('audio/flac'),
        mp3: canPlayType('audio/mpeg'),
        truehd: canPlayType('audio/mp4; codecs="mlpa"'),
    };
}

/**
 * Determine if transcoded streaming should be preferred over direct download
 * Returns true if the browser likely can't play the file natively
 */
export function shouldPreferTranscodedStream(filename: string): boolean {
    const support = detectCodecSupport();
    const ext = filename.toLowerCase();

    // Preserve direct path for likely HDR masters on HDR-capable browsers.
    // Provider transcodes are often SDR and can lose HDR metadata.
    if (isLikelyHdrSource(filename) && support.hdr) {
        return false;
    }

    // MKV files often have AC3/DTS audio which most browsers don't support
    if (ext.endsWith(".mkv") && !support.ac3 && !support.dts && !support.eac3) {
        return true;
    }

    // AVI/WMV are legacy formats with poor browser support
    if (ext.endsWith(".avi") || ext.endsWith(".wmv")) {
        return true;
    }

    return false;
}

/**
 * Get the best streaming URL for the current browser
 * Prefers transcoded formats when native playback is unlikely to work
 */
export function selectBestStreamingUrl(
    downloadUrl: string,
    streamingLinks: Record<string, string> | undefined,
    filename: string
): { url: string; isTranscoded: boolean; format: string } {
    // If no streaming links available, use download URL
    if (!streamingLinks || Object.keys(streamingLinks).length === 0) {
        return { url: downloadUrl, isTranscoded: false, format: "direct" };
    }

    const support = detectCodecSupport();
    const shouldTranscode = shouldPreferTranscodedStream(filename);
    const ios = isIOS();
    const safari = isSafari();
    const likelyHdrSource = isLikelyHdrSource(filename, downloadUrl);

    // If browser + display can do HDR and source is likely HDR, avoid SDR transcoding paths.
    // Keep Safari/iOS on compatibility branch because direct MKV/HEVC playback can still fail there.
    if (likelyHdrSource && support.hdr && !ios && !safari) {
        return { url: downloadUrl, isTranscoded: false, format: "direct (HDR)" };
    }

    // On iOS/Safari, ALWAYS prefer HLS (apple) format if available
    // iOS Safari has very limited codec support and HLS provides best compatibility
    if (ios || safari) {
        if (streamingLinks.apple) {
            return { url: streamingLinks.apple, isTranscoded: true, format: "HLS" };
        }
        // If no HLS available but this is a problematic format, use liveMP4 if available
        if (shouldTranscode && streamingLinks.liveMP4) {
            return { url: streamingLinks.liveMP4, isTranscoded: true, format: "MP4 (transcoded)" };
        }
        // Fallback: try native streaming link if available (may not work for all files)
        if (streamingLinks.native) {
            return { url: streamingLinks.native, isTranscoded: false, format: "native" };
        }
    }

    // If we should transcode (based on file extension and codec support), try various transcoded formats
    if (shouldTranscode) {
        // Prefer liveMP4 for broad compatibility
        if (streamingLinks.liveMP4) {
            return { url: streamingLinks.liveMP4, isTranscoded: true, format: "MP4 (transcoded)" };
        }
        // Try H.264 WebM
        if (streamingLinks.h264WebM && support.vp9) {
            return { url: streamingLinks.h264WebM, isTranscoded: true, format: "WebM" };
        }
        // Try HLS even on non-Apple if available
        if (streamingLinks.apple) {
            return { url: streamingLinks.apple, isTranscoded: true, format: "HLS" };
        }
        // DASH as last transcoded option
        if (streamingLinks.dash) {
            return { url: streamingLinks.dash, isTranscoded: true, format: "DASH" };
        }
    }

    // Default to direct download
    return { url: downloadUrl, isTranscoded: false, format: "direct" };
}

export type PlaybackMode = "native" | "fallback" | "transcode";
/** Device is an internal route for the advanced audio-remux option. */
export type PlaybackEngine = PlaybackMode | "device";

export function migratePlaybackMode(value: unknown): PlaybackMode {
    if (value === "native" || value === "original") return "native";
    if (value === "transcode" || value === "compatible") return "transcode";
    return "fallback";
}

export interface StreamDecision {
    url: string;
    isTranscoded: boolean;
    format: string;
    /** Human-readable reason, shown in the player's stream menu. */
    reason?: string;
}

let cachedSupport: CodecSupport | null = null;
/** Cached per session — probing creates DOM elements. */
export function getCodecSupport(): CodecSupport {
    return (cachedSupport ??= detectCodecSupport());
}

/** Which of a file's real codecs (from provider metadata) this browser can't decode. */
export function getUnsupportedCodecs(info: StreamInfo, audioIndex = info.audioIndex): string[] {
    const support = getCodecSupport() as unknown as Record<string, boolean>;
    const video = normalizeCodec(info.videoCodec);
    const audioTrack = info.audios[audioIndex] ?? info.audios.find((a) => a.isDefault) ?? info.audios[0];
    const audio = normalizeCodec(audioTrack?.codec);
    const blocked: string[] = [];
    if (video && video in support && !support[video]) blocked.push(codecLabel(video));
    if (audio && audio in support && !support[audio]) blocked.push(codecLabel(audio));
    return blocked;
}

/**
 * Choose between the original file and the provider's compatible (transcoded HLS)
 * stream. With provider metadata we know the real codecs, so compatible files
 * keep full original quality and only unplayable ones get transcoded.
 */
export function decideStream({
    downloadUrl, streamingLinks, fileName, info, engine, profile = getDeviceProfile(),
}: {
    downloadUrl: string;
    streamingLinks?: Record<string, string>;
    fileName: string;
    info?: StreamInfo;
    engine: PlaybackEngine;
    profile?: DeviceProfile | null;
}): StreamDecision {
    const original = { url: downloadUrl, isTranscoded: false, format: "Original" };
    if (engine === "native" || engine === "device") return original;
    const hls = streamingLinks?.apple;
    if (engine === "transcode") {
        return hls
            ? { url: hls, isTranscoded: true, format: "HLS" }
            : { url: "", isTranscoded: false, format: "Unavailable", reason: "Transcoding isn't available for this file or account/plan. Try native playback." };
    }
    const issue = profile ? getOriginalIssue(profile, detectContainer(fileName, downloadUrl), info) : null;
    if (issue) return hls
        ? { url: hls, isTranscoded: true, format: "HLS", reason: issue }
        : { url: "", isTranscoded: false, format: "Unavailable", reason: issue };
    return original;
}

/**
 * Chrome-only probe: video frames decoding while zero audio bytes decode means
 * the audio codec is unsupported (Chrome plays such files silently, no error).
 * Returns null when the browser doesn't expose the counters.
 */
export function isAudioSilentlyUnsupported(video: HTMLVideoElement): boolean | null {
    const v = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
    if (typeof v.webkitAudioDecodedByteCount !== "number" || typeof v.webkitVideoDecodedByteCount !== "number") return null;
    return v.webkitVideoDecodedByteCount > 0 && v.webkitAudioDecodedByteCount === 0;
}
