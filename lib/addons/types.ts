// Stremio Addon Types

export enum Resolution {
    UHD_4K = "2160p",
    QHD_1440P = "1440p",
    FHD_1080P = "1080p",
    HD_720P = "720p",
    SD_480P = "480p",
    SD_360P = "360p",
}

export enum SourceQuality {
    BLURAY_REMUX = "BluRay REMUX",
    BLURAY = "BluRay",
    WEB_DL = "WEB-DL",
    WEBRIP = "WEBRip",
    HDTV = "HDTV",
    DVDRIP = "DVDRip",
    HDRIP = "HDRip",
    SCR = "SCR",
    TC = "TC",
    TS = "TS",
    CAM = "CAM",
}

export interface AddonManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    logo?: string;
    /**
     * Stremio manifests may declare resources as strings (e.g. "subtitles") or as objects
     * (e.g. { name: "subtitles", types: ["movie", "series"] }).
     */
    resources: Array<
        | string
        | {
            name: string;
            types: string[];
            idPrefixes?: string[];
        }
    >;
    types: string[];
    catalogs?: Array<{
        type: string;
        id: string;
        name?: string;
    }>;
    behaviorHints?: {
        adult?: boolean;
        p2p?: boolean;
        configurable?: boolean;
        configurationRequired?: boolean;
    };
}

export interface AddonStream {
    name?: string;
    title?: string;
    description?: string;
    url?: string;
    infoHash?: string;
    fileIdx?: number;
    behaviorHints?: {
        bingeGroup?: string;
        videoHash?: string;
        filename?: string;
        notWebReady?: boolean;
        videoSize?: number;
    };
}

export interface AddonStreamResponse {
    streams: AddonStream[];
}

/** Stremio subtitles resource: one subtitle track (e.g. one language). */
export interface AddonSubtitle {
    url: string;
    lang: string; // ISO 639-2 (e.g. "en") or "eng"
    name?: string;
}

export interface AddonSubtitlesResponse {
    subtitles: AddonSubtitle[];
    cacheMaxAge?: number;
}

export interface AddonSource {
    title: string;
    description?: string;
    size?: string;
    resolution?: Resolution;
    quality?: SourceQuality;
    peers?: string;
    magnet?: string;
    url?: string;
    fileIdx?: number;
    isCached?: boolean;
    addonId: string;
    addonName: string;
}

export interface Addon {
    id: string; // UUID from database
    name: string;
    url: string;
    enabled: boolean;
    order: number;
}

export interface TvSearchParams {
    season: number;
    episode: number;
}

export class AddonError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly addonId?: string
    ) {
        super(message);
        this.name = "AddonError";
    }
}

// ── Manifest capability helpers ────────────────────────────────────

type ManifestLike = { resources?: Array<string | { name?: string }> };

/** Check if an addon manifest declares the "stream" resource (Stremio protocol). */
export function addonSupportsStreams(manifest: ManifestLike): boolean {
    return (
        manifest?.resources?.some((r) =>
            typeof r === "string" ? r === "stream" : r?.name === "stream"
        ) ?? false
    );
}

/** Check if an addon manifest declares the "subtitles" resource (Stremio protocol). */
export function addonSupportsSubtitles(manifest: ManifestLike): boolean {
    return (
        manifest?.resources?.some((r) =>
            typeof r === "string" ? r === "subtitles" : r?.name === "subtitles"
        ) ?? false
    );
}
