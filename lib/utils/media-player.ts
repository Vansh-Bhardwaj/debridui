import { MediaPlayer, Platform } from "../types";

declare global {
    interface NavigatorUAData {
        platform: string;
    }
    interface Navigator {
        userAgentData?: NavigatorUAData;
    }
}
import { useSettingsStore } from "../stores/settings";
import { VLCBridgeClient } from "../vlc-bridge";
import { startVLCProgressSync } from "../vlc-progress";
import type { ProgressKey } from "@/hooks/use-progress";
import { toast } from "sonner";

// Singleton VLC Bridge client — lazy initialized
let vlcBridge: VLCBridgeClient | null = null;
let vlcBridgeDetected: boolean | null = null;

/** Get or create the VLC Bridge client */
function getVLCBridge(): VLCBridgeClient {
    if (!vlcBridge) {
        vlcBridge = new VLCBridgeClient();
    }
    return vlcBridge;
}

/** Check if VLC Bridge extension is available (cached after first check) */
async function isVLCBridgeAvailable(): Promise<boolean> {
    if (vlcBridgeDetected !== null) return vlcBridgeDetected;
    try {
        vlcBridgeDetected = await getVLCBridge().detect();
    } catch {
        vlcBridgeDetected = false;
    }
    return vlcBridgeDetected;
}

/** Reset bridge detection (call when extension might have been installed/removed) */
export const resetVLCBridgeDetection = (): void => {
    vlcBridgeDetected = null;
};

/** Get bridge client for direct use (e.g. progress tracking, controls) */
export const getVLCBridgeClient = (): VLCBridgeClient => getVLCBridge();

export interface ParsedUserAgent {
    browser: string;
    os: string;
    device: string;
    platform: Platform;
    /** e.g. "Chrome on macOS" */
    summary: string;
}

const BROWSER_PATTERNS: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/[\d.]+/i, "Edge"],
    [/OPR\/[\d.]+|Opera\/[\d.]+/i, "Opera"],
    [/Brave\/[\d.]+/i, "Brave"],
    [/Vivaldi\/[\d.]+/i, "Vivaldi"],
    [/SamsungBrowser\/[\d.]+/i, "Samsung Internet"],
    [/Firefox\/[\d.]+/i, "Firefox"],
    [/CriOS\/[\d.]+/i, "Chrome"],
    [/FxiOS\/[\d.]+/i, "Firefox"],
    [/Chrome\/[\d.]+/i, "Chrome"],
    [/Safari\/[\d.]+/i, "Safari"],
];

const OS_PATTERNS: [RegExp, string, Platform][] = [
    [/Android\s?[\d.]*/i, "Android", Platform.ANDROID],
    [/iPhone|iPad|iPod/i, "iOS", Platform.IOS],
    [/Mac OS X[\s_][\d._]+|Macintosh/i, "macOS", Platform.MACOS],
    [/Windows NT\s?[\d.]*/i, "Windows", Platform.WINDOWS],
    [/CrOS/i, "Chrome OS", Platform.LINUX],
    [/Linux/i, "Linux", Platform.LINUX],
];

const DEVICE_PATTERNS: [RegExp, string][] = [
    [/iPad/i, "Tablet"],
    [/iPhone/i, "Phone"],
    [/iPod/i, "Phone"],
    [/Android.*Mobile/i, "Phone"],
    [/Android/i, "Tablet"],
    [/Mobile/i, "Phone"],
];

const UNKNOWN_UA: ParsedUserAgent = {
    browser: "Unknown",
    os: "Unknown",
    device: "Desktop",
    platform: Platform.UNKNOWN,
    summary: "Unknown device",
};

export const parseUserAgent = (ua: string | null | undefined): ParsedUserAgent => {
    if (!ua) return UNKNOWN_UA;

    const browser = BROWSER_PATTERNS.find(([re]) => re.test(ua))?.[1] ?? "Unknown";
    const osMatch = OS_PATTERNS.find(([re]) => re.test(ua));
    const os = osMatch?.[1] ?? "Unknown";
    const platform = osMatch?.[2] ?? Platform.UNKNOWN;
    const device = DEVICE_PATTERNS.find(([re]) => re.test(ua))?.[1] ?? "Desktop";

    const summary =
        browser !== "Unknown" && os !== "Unknown"
            ? `${browser} on ${os}`
            : browser !== "Unknown"
              ? browser
              : os !== "Unknown"
                ? os
                : "Unknown device";

    return { browser, os, device, platform, summary };
};

let cachedPlatform: Platform | null = null;

/** Resolve platform via User-Agent Client Hints (reliable on Android tablets in desktop mode) */
const detectViaClientHints = (): Platform | null => {
    const platform = navigator.userAgentData?.platform;
    if (!platform) return null;
    const lower = platform.toLowerCase();
    if (lower === "android") return Platform.ANDROID;
    if (lower === "ios") return Platform.IOS;
    if (lower === "macos" || lower === "macosx") return Platform.MACOS;
    if (lower === "windows") return Platform.WINDOWS;
    if (lower === "linux" || lower === "chromeos") return Platform.LINUX;
    return null;
};

/** Detect the current browser's platform (cached after first call) */
export const detectPlatform = (): Platform => {
    if (cachedPlatform !== null) return cachedPlatform;

    if (typeof navigator === "undefined") {
        cachedPlatform = Platform.UNKNOWN;
        return cachedPlatform;
    }

    // Prefer Client Hints — reports real platform even when UA is spoofed (e.g. Android tablets in desktop mode)
    cachedPlatform = detectViaClientHints() ?? parseUserAgent(navigator.userAgent).platform;
    return cachedPlatform;
};

export const isMobileOrTablet = (): boolean => {
    const platform = detectPlatform();
    return platform === Platform.ANDROID || platform === Platform.IOS;
};

export const PLAYER_PLATFORM_SUPPORT: Record<MediaPlayer, Platform[]> = {
    [MediaPlayer.BROWSER]: [Platform.ANDROID, Platform.IOS, Platform.MACOS, Platform.WINDOWS, Platform.LINUX],
    [MediaPlayer.IINA]: [Platform.MACOS],
    [MediaPlayer.INFUSE]: [Platform.IOS, Platform.MACOS],
    [MediaPlayer.VLC]: [Platform.ANDROID, Platform.IOS, Platform.MACOS, Platform.WINDOWS, Platform.LINUX],
    [MediaPlayer.MPV]: [Platform.MACOS, Platform.WINDOWS, Platform.LINUX],
    [MediaPlayer.POTPLAYER]: [Platform.WINDOWS],
    [MediaPlayer.KODI]: [Platform.ANDROID, Platform.IOS, Platform.MACOS, Platform.WINDOWS, Platform.LINUX],
    [MediaPlayer.MX_PLAYER]: [Platform.ANDROID],
    [MediaPlayer.MX_PLAYER_PRO]: [Platform.ANDROID],
};

export const isSupportedPlayer = (player: MediaPlayer, platform?: Platform): boolean => {
    const currentPlatform = platform || detectPlatform();
    const supportedPlatforms = PLAYER_PLATFORM_SUPPORT[player];
    return supportedPlatforms.includes(currentPlatform);
};

/** Normalize URL so protocol has a colon (fixes https// -> https://). */
const normalizeUrl = (url: string): string => {
    const trimmed = url.trim();
    if (/^https?\/\//i.test(trimmed)) {
        return trimmed.replace(/^(https?)\/\//i, "$1://");
    }
    return trimmed;
};

const generateVlcUrl = (url: string, fileName: string): string => {
    const normalized = normalizeUrl(url);
    const platform = detectPlatform();
    if (platform === Platform.ANDROID) {
        // Android: use intent with explicit action and encoded URL extra
        // Passing URL as S.url extra avoids issues with special characters in the URI path
        const encodedTitle = encodeURIComponent(fileName);
        const encodedUrl = encodeURIComponent(normalized);
        return `intent:#Intent;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc;S.title=${encodedTitle};S.url=${encodedUrl};end`;
    }
    if (platform === Platform.IOS) {
        // iOS: use vlc-x-callback for proper URL handling
        return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(normalized)}`;
    }
    // Desktop: vlc:// protocol
    return `vlc://${encodeURIComponent(normalized)}`;
};

const generateMxPlayerUrl = (url: string, packageName: string, fileName: string): string => {
    const encodedTitle = encodeURIComponent(fileName);
    return `intent:${url}#Intent;type=video/*;package=${packageName};S.title=${encodedTitle};end`;
};

type PlayerUrlGenerator = (url: string, fileName: string) => string;

const PLAYER_URLS: Record<Exclude<MediaPlayer, MediaPlayer.BROWSER>, PlayerUrlGenerator> = {
    [MediaPlayer.IINA]: (url) => `iina://weblink?url=${encodeURIComponent(url)}`,
    [MediaPlayer.INFUSE]: (url) => `infuse://x-callback-url/play?url=${encodeURIComponent(url)}`,
    [MediaPlayer.VLC]: (url, fileName) => generateVlcUrl(url, fileName),
    [MediaPlayer.MPV]: (url) => `mpv://${encodeURIComponent(url)}`,
    [MediaPlayer.POTPLAYER]: (url) => `potplayer://${encodeURIComponent(url)}`,
    [MediaPlayer.KODI]: (url) => `kodi://${encodeURIComponent(url)}`,
    [MediaPlayer.MX_PLAYER]: (url, fileName) => generateMxPlayerUrl(url, "com.mxtech.videoplayer.ad", fileName),
    [MediaPlayer.MX_PLAYER_PRO]: (url, fileName) => generateMxPlayerUrl(url, "com.mxtech.videoplayer.pro", fileName),
};

export const openInPlayer = ({
    url,
    fileName,
    player,
    subtitles,
    progressKey,
}: {
    url: string;
    fileName: string;
    player?: MediaPlayer;
    subtitles?: string[];
    progressKey?: ProgressKey;
}): void => {
    const selectedPlayer = player || useSettingsStore.getState().get("mediaPlayer");

    if (selectedPlayer === MediaPlayer.BROWSER) {
        toast.error("Browser preview is not supported for this file. Please select a different player.");
        return;
    }

    // VLC on desktop: try extension bridge first for full control + subtitles
    if (selectedPlayer === MediaPlayer.VLC && !isMobileOrTablet()) {
        openInVLCBridge(url, subtitles, progressKey).catch(() => {
            // Fall back to protocol handler
            const playerUrl = PLAYER_URLS[selectedPlayer](url, fileName);
            window.open(playerUrl, "_self");
        });
        return;
    }

    const playerUrl = PLAYER_URLS[selectedPlayer](url, fileName);

    // On Android, use location.href for intent:// URLs — more reliable than window.open
    if (detectPlatform() === Platform.ANDROID && playerUrl.startsWith("intent:")) {
        window.location.href = playerUrl;
    } else {
        window.open(playerUrl, "_self");
    }
};

/** Read saved progress from localStorage (mirrors use-progress logic). */
function readSavedProgress(key: ProgressKey): number | null {
    try {
        const storageKey = key.type === "show" && key.season !== undefined && key.episode !== undefined
            ? `progress:${key.imdbId}:s${key.season}e${key.episode}`
            : `progress:${key.imdbId}`;
        const stored = localStorage.getItem(storageKey);
        if (!stored) return null;
        const { progressSeconds, durationSeconds } = JSON.parse(stored);
        if (!progressSeconds || !durationSeconds || durationSeconds <= 0) return null;
        const pct = (progressSeconds / durationSeconds) * 100;
        // Only resume if between 1% and 95%
        return pct >= 1 && pct <= 95 ? progressSeconds : null;
    } catch {
        return null;
    }
}

/** Try to play via VLC Bridge extension. Rejects if extension unavailable. */
async function openInVLCBridge(url: string, subtitles?: string[], progressKey?: ProgressKey): Promise<void> {
    const available = await isVLCBridgeAvailable();
    if (!available) throw new Error("VLC Bridge not available");

    const bridge = getVLCBridge();

    // Proxy subtitle URLs through the app so VLC can fetch them reliably
    const subs = subtitles?.slice(0, 3).map((u, i) => proxySubtitleUrl(u, i)).filter(Boolean) as string[] | undefined;

    const result = await bridge.play(url, subs?.length ? { subtitles: subs } : undefined);

    if (!result.success && result.code === "VLC_NOT_RUNNING") {
        toast.error("VLC is not running", {
            description: "Open VLC with HTTP interface enabled, then try again",
        });
        throw new Error("VLC not running");
    }

    if (!result.success) {
        toast.error("VLC playback failed", { description: result.error });
        throw new Error(result.error);
    }

    toast.success("Playing in VLC");
    if (progressKey) {
        startVLCProgressSync(progressKey, url);
        // Resume from saved position
        const resumeAt = readSavedProgress(progressKey);
        if (resumeAt && resumeAt > 5) {
            // Small delay to let VLC load the stream before seeking
            setTimeout(() => bridge.seek(resumeAt), 1500);
        }
    }
}

/** Convert a raw subtitle URL to a proxied URL with a descriptive filename
 *  so VLC can detect the language and type from the path. */
function proxySubtitleUrl(url: string, index?: number): string {
    if (typeof window === "undefined") return url;
    const label = index && index > 0 ? `English_${index + 1}.srt` : "English.srt";
    return `${window.location.origin}/api/subtitles/vlc/${label}?url=${encodeURIComponent(url)}`;
}
