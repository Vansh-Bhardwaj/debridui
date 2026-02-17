/**
 * Device Sync Protocol — shared message types between client and sync worker.
 *
 * These types mirror the DO's protocol exactly. Kept in the main app
 * to avoid a build dependency on the worker.
 */

// ── Device Types ───────────────────────────────────────────────────────────

export type DeviceType = "desktop" | "mobile" | "tablet" | "tv";

/** Compact streaming preferences sent over WebSocket so the controller
 *  can run source selection with the target device's quality settings. */
export interface DeviceStreamingPrefs {
    profileId: string;
    customRange?: {
        minResolution: string;
        maxResolution: string;
        minSourceQuality: string;
        maxSourceQuality: string;
    };
    allowUncached: boolean;
    preferredLanguage: string;
    preferCached: boolean;
}

export interface DeviceInfo {
    id: string;
    name: string;
    deviceType: DeviceType;
    browser: string;
    isPlaying: boolean;
    nowPlaying: NowPlayingInfo | null;
    lastSeen: number;
    /** Streaming quality prefs — sent on registration so remote controllers
     *  can select sources matching this device's profile. */
    streamingPrefs?: DeviceStreamingPrefs;
}

export interface TrackInfo {
    id: number;
    name: string;
    active?: boolean;
}

/** Compact source info sent over WebSocket (no URLs — those stay on the playing device). */
export interface SourceSummary {
    index: number;
    title: string;
    resolution?: string;
    quality?: string;
    size?: string;
    isCached?: boolean;
    addonName: string;
}

export interface NowPlayingInfo {
    title: string;
    imdbId?: string;
    type?: "movie" | "show";
    season?: number;
    episode?: number;
    progress: number; // seconds
    duration: number; // seconds
    paused: boolean;
    url?: string;
    volume?: number; // 0-100
    audioTracks?: TrackInfo[];
    subtitleTracks?: TrackInfo[];
    sources?: SourceSummary[];
}

export interface TransferPayload {
    url: string;
    title: string;
    imdbId?: string;
    mediaType?: "movie" | "show";
    season?: number;
    episode?: number;
    subtitles?: Array<{ url: string; lang: string; name?: string }>;
    progressSeconds?: number;
    durationSeconds?: number;
}

// ── Browse / Remote Media Browser ──────────────────────────────────────────

/** Lightweight file info sent via the DO (no download URLs — those stay on the target). */
export interface BrowseFileItem {
    id: string;
    name: string;
    size: number;
    status: string;
    progress?: number;
    createdAt?: string;
}

export interface BrowseRequest {
    requestId: string;
    action: "list-files" | "search";
    query?: string;
    offset?: number;
    limit?: number;
}

export interface BrowseResponse {
    requestId: string;
    files: BrowseFileItem[];
    total?: number;
    hasMore?: boolean;
    error?: string;
}

// ── Notifications ──────────────────────────────────────────────────────────

export interface DeviceNotification {
    id: string;
    title: string;
    description?: string;
    icon?: "download" | "play" | "info" | "warning" | "error";
    action?: { label: string; transferPayload?: TransferPayload };
    expiresAt?: number;
}

// ── Playback Queue ─────────────────────────────────────────────────────────

export interface QueueItem {
    id: string;
    title: string;
    url: string;
    imdbId?: string;
    mediaType?: "movie" | "show";
    season?: number;
    episode?: number;
    subtitles?: Array<{ url: string; lang: string; name?: string }>;
    addedBy: string; // device name
    addedAt: number;
}

// ── Client → Server Messages ───────────────────────────────────────────────

export type ClientMessage =
    | { type: "register"; device: Pick<DeviceInfo, "id" | "name" | "deviceType" | "browser" | "streamingPrefs"> }
    | { type: "now-playing"; state: NowPlayingInfo | null }
    | { type: "command"; target: string; action: RemoteAction; payload?: Record<string, unknown> }
    | { type: "transfer"; target: string; playback: TransferPayload }
    | { type: "control-claim"; target: string }
    | { type: "control-release"; target: string }
    | { type: "browse-request"; target: string; request: BrowseRequest }
    | { type: "browse-response"; target: string; response: BrowseResponse }
    | { type: "notify"; notification: DeviceNotification }
    | { type: "queue-add"; item: Omit<QueueItem, "id" | "addedAt"> }
    | { type: "queue-remove"; itemId: string }
    | { type: "queue-clear" }
    | { type: "queue-reorder"; itemIds: string[] }
    | { type: "queue-get" }
    | { type: "ping" };

export type RemoteAction =
    | "play"
    | "pause"
    | "toggle-pause"
    | "seek"
    | "volume"
    | "stop"
    | "next"
    | "previous"
    | "set-audio-track"
    | "set-subtitle-track"
    | "fullscreen"
    | "play-episode"
    | "play-source"
    | "play-media";

// ── Server → Client Messages ───────────────────────────────────────────────

export type ServerMessage =
    | { type: "devices"; devices: DeviceInfo[] }
    | { type: "command"; from: string; fromName: string; action: string; payload?: Record<string, unknown> }
    | { type: "transfer"; from: string; fromName: string; playback: TransferPayload }
    | { type: "device-joined"; device: DeviceInfo }
    | { type: "device-left"; deviceId: string }
    | { type: "now-playing-update"; deviceId: string; state: NowPlayingInfo | null }
    | { type: "control-claimed"; controllerId: string; controllerName: string }
    | { type: "control-released" }
    | { type: "browse-request"; from: string; request: BrowseRequest }
    | { type: "browse-response"; from: string; response: BrowseResponse }
    | { type: "notification"; from: string; fromName: string; notification: DeviceNotification }
    | { type: "queue-updated"; queue: QueueItem[] }
    | { type: "error"; message: string }
    | { type: "pong" };

// ── Device Detection Helpers ───────────────────────────────────────────────

const DEVICE_ID_KEY = "debridui-device-id";

/** Get or create a persistent device ID (stored in localStorage). */
export function getDeviceId(): string {
    if (typeof window === "undefined") return "server";
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

/** Detect device type + browser from UA. Zero deps. */
export function detectDevice(): Pick<DeviceInfo, "id" | "name" | "deviceType" | "browser"> {
    if (typeof navigator === "undefined") {
        return { id: getDeviceId(), name: "Server", deviceType: "desktop", browser: "Node" };
    }

    const ua = navigator.userAgent;
    let browser = "Browser";
    let deviceType: DeviceType = "desktop";
    let platform = "Unknown";

    // Browser detection
    if (ua.includes("Firefox/")) browser = "Firefox";
    else if (ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("OPR/") || ua.includes("Opera")) browser = "Opera";
    else if (ua.includes("Chrome/") && !ua.includes("Edg/")) browser = "Chrome";
    else if (ua.includes("Safari/") && !ua.includes("Chrome/")) browser = "Safari";

    // Platform detection — order matters: check iOS-specific strings before macOS,
    // since iOS 13+ Safari with "Request Desktop Website" sends "Macintosh" in the UA.
    if (ua.includes("iPhone")) { platform = "iOS"; deviceType = "mobile"; }
    else if (ua.includes("iPad")) { platform = "iOS"; deviceType = "tablet"; }
    else if (ua.includes("Android")) {
        platform = "Android";
        deviceType = ua.includes("Mobile") ? "mobile" : "tablet";
    } else if (ua.includes("CrKey") || ua.includes("TV") || ua.includes("SmartTV")) {
        platform = "TV";
        deviceType = "tv";
    } else if (ua.includes("Windows")) { platform = "Windows"; }
    else if (ua.includes("Macintosh") || ua.includes("Mac OS")) {
        // iOS Safari 13+ masquerades as macOS — detect via touch support
        if (navigator.maxTouchPoints > 1) {
            platform = "iOS";
            // Differentiate phone (small screen) from tablet (large screen)
            deviceType = Math.min(screen.width, screen.height) < 768 ? "mobile" : "tablet";
        } else {
            platform = "macOS";
        }
    } else if (ua.includes("Linux")) { platform = "Linux"; }

    // Use Client Hints if available (Chromium-only — not on Safari/Firefox)
    const uaData = (navigator as NavigatorWithUAData).userAgentData;
    if (uaData) {
        if (uaData.mobile) deviceType = "mobile";
        if (uaData.platform) platform = uaData.platform;
        const brand = uaData.brands?.find(
            (b) => !b.brand.includes("Not") && !b.brand.includes("Chromium")
        );
        if (brand) browser = brand.brand;
    }

    return {
        id: getDeviceId(),
        name: `${browser} on ${platform}`,
        deviceType,
        browser,
    };
}

interface NavigatorWithUAData extends Navigator {
    userAgentData?: {
        mobile: boolean;
        platform: string;
        brands?: Array<{ brand: string; version: string }>;
    };
}
