import {
    DebridFile,
    DebridFileStatus,
    DebridNode,
    DebridFileNode,
    DebridLinkInfo,
    DebridFileList,
    DebridFileAddStatus,
    OperationResult,
    AccountType,
    User,
    DebridAuthError,
    DebridError,
    DebridRateLimitError,
    WebDownload,
    WebDownloadAddResult,
    WebDownloadStatus,
    WebDownloadList,
} from "@/lib/types";
import BaseClient, { type StreamHint } from "./base";
import {
    pickPreferredAudio,
    registerStreamInfo,
    setProviderTranscodeAvailable,
    type StreamInfo,
    type StreamResolution,
    type StreamVariantOptions,
} from "@/lib/streaming/stream-info";
import { USER_AGENT } from "../constants";
import { getProxyUrl } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";

// TorBox Search API types
export interface TorBoxSearchResult {
    hash: string;
    raw_title: string;
    title: string;
    magnet: string;
    last_known_seeders: number;
    last_known_peers: number;
    size: number;
    files: number;
    type: string;
    age: string;
    cached: boolean;
}

interface TorBoxSearchResponse {
    success: boolean;
    message: string;
    data: {
        metadata: null;
        torrents: TorBoxSearchResult[];
    };
}

// TorBox API Response types
export interface TorBoxUser {
    id: number;
    auth_id: string;
    created_at: string;
    updated_at: string;
    plan: number;
    total_downloaded?: number;
    customer?: string | null;
    is_subscribed?: boolean;
    premium_expires_at?: string | null;
    cooldown_until?: string | null;
    email: string;
    user_referral?: string;
    base_email?: string;
    total_bytes_downloaded?: number;
    total_bytes_uploaded?: number;
    torrents_downloaded?: number;
    web_downloads_downloaded?: number;
    usenet_downloads_downloaded?: number;
    additional_concurrent_slots?: number;
    long_term_seeding?: boolean;
    long_term_storage?: boolean;
    is_vendor?: boolean;
    vendor_id?: number;
    purchases_referred?: number;
    settings?: {
        email_notifications?: boolean;
        web_notifications?: boolean;
        mobile_notifications?: boolean;
        rss_notifications?: boolean;
        download_speed_in_tab?: boolean;
        show_tracker_in_torrent?: boolean;
        stremio_quality?: number[];
        stremio_resolution?: number[];
        stremio_language?: number[];
        stremio_cache?: number[];
        stremio_size_lower?: number;
        google_drive_folder_id?: string;
        onedrive_save_path?: string;
        discord_id?: string;
        discord_notifications?: boolean;
        stremio_allow_adult?: boolean;
        stremio_seed_torrents?: number;
        seed_torrents?: number;
        allow_zipped?: boolean;
        stremio_allow_zipped?: boolean;
        onefichier_folder_id?: string;
        gofile_folder_id?: string;
        jdownloader_notifications?: boolean;
        webhook_notifications?: boolean;
        webhook_url?: string;
        telegram_notifications?: boolean;
        telegram_id?: string;
        mega_email?: string;
        mega_password?: string;
        stremio_sort?: string;
        cdn_selection?: string;
        stremio_use_custom_search_engines?: string;
        stremio_result_sort?: string;
        webdav_use_local_files?: boolean;
        stremio_legacy_your_media?: boolean;
        stremio_only_your_media_streams?: boolean;
        stremio_disable_your_media_streams?: boolean;
        webdav_use_folder_view?: boolean;
        webdav_flatten?: boolean;
        stremio_limit_per_resolution_torrent?: number;
        stremio_limit_per_resolution_usenet?: number;
        stremio_size_upper?: number;
        stremio_torrent_seeders_cutoff?: number;
        pixeldrain_api_key?: string;
        onefichier_api_key?: string;
        gofile_api_key?: string;
        patreon_id?: string;
        stremio_wait_for_download_usenet?: boolean;
        stremio_wait_for_download_torrent?: boolean;
        stremio_disable_filtered_note?: boolean;
        stremio_emoji_in_description?: boolean;
        dashboard_filter?: {
                active?: boolean;
            cached?: boolean;
            queued?: boolean;
            private?: boolean;
            borrowed?: boolean;
            inactive?: boolean;
            torrents?: boolean;
            uncached?: boolean;
            uploading?: boolean;
            processing?: boolean;
            downloading?: boolean;
            web_downloads?: boolean;
            download_ready?: boolean;
            usenet_downloads?: boolean;
        };
        web_player_always_transcode?: boolean;
        web_player_always_skip_intro?: boolean;
        web_player_audio_preferred_language?: string;
        web_player_subtitle_preferred_language?: string;
        web_player_disable_prestream_selector?: boolean;
        dashboard_sort?: string;
        web_player_disable_next_up_dialogue?: boolean;
        web_player_enable_scrobbling?: boolean;
        append_filename_to_links?: boolean;
    };
    download_monthly?: number;
    referred_by?: string | null;
}

export interface TorBoxStats {
    general?: { total_downloaded?: number; total_uploaded?: number; ratio?: number; total_items_downloaded?: number };
}

type TorBoxUsage = { active: number | null; queued: number | null };
export interface TorBoxAccountDetails {
    planTier: number;
    planName: string;
    expiry: string | null;
    renewal: boolean | null;
    totalDownloaded: number | null;
    totalUploaded: number | null;
    activeSlots: number | null;
    maxSlots: number | null;
    queued: number | null;
    cooldown_until: string | null;
    server: number | null;
    streamingAllowed: boolean;
    transcodeAllowed: boolean;
    usage: { torrent: TorBoxUsage; usenet: TorBoxUsage; webdl: TorBoxUsage };
    downloads: { torrent: number | null; usenet: number | null; webdl: number | null };
    referral: string | null;
    notifications: { email: boolean | null; web: boolean | null };
}

// Plan IDs: API "Get User Data". Slots: torbox.app/pricing (2026-11-13).
const TORBOX_PLANS: Record<number, { name: string; slots: number }> = {
    0: { name: "Free", slots: 1 }, 1: { name: "Essential", slots: 3 },
    2: { name: "Pro", slots: 10 }, 3: { name: "Standard", slots: 5 },
};

export function normalizeTorBoxAccount(user: TorBoxUser, stats: TorBoxStats | null = null, usage: TorBoxUsage[] = []): TorBoxAccountDetails {
    const plan = TORBOX_PLANS[user.plan];
    const expiry = user.premium_expires_at ?? null;
    const paidActive = !!expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now();
    // TorBox documents streaming/transcode as a Pro feature.
    const transcodeAllowed = user.plan === 2 && paidActive;
    const unknown = { active: null, queued: null };
    const [torrent = unknown, usenet = unknown, webdl = unknown] = usage;
    const sum = (key: keyof TorBoxUsage) => [torrent, usenet, webdl].every((item) => item[key] !== null)
        ? [torrent, usenet, webdl].reduce((total, item) => total + item[key]!, 0) : null;
    return {
        planTier: user.plan, planName: plan?.name ?? "Unknown", expiry, renewal: user.is_subscribed ?? null,
        totalDownloaded: stats?.general?.total_downloaded ?? user.total_bytes_downloaded ?? null,
        totalUploaded: stats?.general?.total_uploaded ?? user.total_bytes_uploaded ?? null,
        activeSlots: sum("active"), queued: sum("queued"),
        maxSlots: plan ? plan.slots + Math.max(0, user.additional_concurrent_slots ?? 0) : null,
        cooldown_until: user.cooldown_until ?? null,
        server: null, // Current user/me schema has no assigned server field.
        streamingAllowed: transcodeAllowed, transcodeAllowed,
        usage: { torrent, usenet, webdl },
        downloads: { torrent: user.torrents_downloaded ?? null, usenet: user.usenet_downloads_downloaded ?? null, webdl: user.web_downloads_downloaded ?? null },
        referral: user.user_referral ?? null,
        notifications: { email: user.settings?.email_notifications ?? null, web: user.settings?.web_notifications ?? null },
    };
}

export interface TorBoxUsenetDownload {
    id: number; name: string; hash: string; size: number; created_at: string;
    progress: number; download_state: string; download_speed: number;
    active: boolean; cached: boolean; download_finished: boolean; download_present: boolean;
    cached_at?: string; files?: TorBoxFile[];
}

export function mapTorBoxUsenetItem(item: TorBoxUsenetDownload): DebridFile {
    const state = item.download_state.toLowerCase();
    const status: DebridFileStatus = item.download_finished && item.download_present ? "completed"
        : /error|fail|missing/.test(state) ? "failed"
        : /queued|pending|stalled/.test(state) ? "waiting"
        : state === "paused" ? "paused"
        : /download|metadl/.test(state) ? "downloading" : "processing";
    return {
        id: `usenet:${item.id}`, name: item.name, size: Math.max(0, item.size), status,
        progress: Math.min(100, Math.max(0, item.progress * 100)), downloadSpeed: item.download_speed,
        createdAt: new Date(item.created_at), completedAt: item.cached_at ? new Date(item.cached_at) : undefined,
        files: item.files?.map((file) => ({ id: `usenet:${item.id}:${file.id}`, name: file.short_name || file.name, size: file.size, type: "file", children: [] })),
    };
}

interface TorBoxTorrent {
    id: number;
    hash: string;
    created_at: string;
    updated_at: string;
    magnet: string;
    size: number;
    active: boolean;
    name: string;
    progress: number;
    download_state: string;
    seeds: number;
    peers: number;
    download_speed: number;
    upload_speed: number;
    eta: number;
    server: number;
    inactive_check: number;
    cached: boolean;
    expires_at: string;
    download_present: boolean;
    download_finished: boolean;
    auth_id: string;
    files?: TorBoxFile[];
    cached_at?: string;
}

interface TorBoxFile {
    id: number;
    name: string;
    size: number;
    mimetype?: string;
    md5?: string;
    s3_path?: string;
    short_name?: string;
}

interface TorBoxResponse<T> {
    success: boolean;
    error?: string;
    detail?: string;
    data?: T;
}

interface TorBoxStreamData {
    hls_url?: string;
    audio_index?: number;
    resolution_index?: number | null;
    needs_transcoding?: boolean;
    metadata?: {
        video?: { codec?: string; width?: number; height?: number };
        audios?: { codec: string; language?: string; language_full?: string; title?: string; channels?: number; default?: boolean }[];
    };
}

// TorBox chosen_resolution_index values (it never upscales).
const TORBOX_RESOLUTIONS: StreamResolution[] = [
    { index: 7, label: "2160p", height: 2160 },
    { index: 6, label: "1440p", height: 1440 },
    { index: 5, label: "1080p", height: 1080 },
    { index: 4, label: "720p", height: 720 },
    { index: 3, label: "480p", height: 480 },
];

const VIDEO_FILE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|wmv)$/i;

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** Short-lived per-account caches: the library listing is ~3 MB on big accounts, and
 *  the same lookup runs twice per play (prefetch at source pick + player mount). */
const LIBRARY_TTL_MS = 60_000;
const STREAM_TTL_MS = 120_000;
const libraryCache = new Map<string, { at: number; promise: Promise<TorBoxTorrent[]> }>();
const streamLinksCache = new Map<string, { at: number; promise: Promise<Record<string, string>> }>();
/** Torrents this session already added for playback (see addAndFind). */
const addedTorrents = new Set<string>();

function cached<T>(map: Map<string, { at: number; promise: Promise<T> }>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.promise;
    const promise = load();
    map.set(key, { at: Date.now(), promise });
    promise.catch(() => map.delete(key));
    return promise;
}

const baseName = (name: string) => safeDecode(name).split("/").pop()!.toLowerCase();

interface TorBoxWebDownload {
    id: number;
    hash: string;
    created_at: string;
    updated_at: string;
    name: string;
    size: number;
    download_state: string;
    progress: number;
    download_speed: number;
    eta: number;
    server: number;
    download_present: boolean;
    download_finished: boolean;
    download_url: string;
    original_url: string;
    auth_id: string;
    error?: string;
}

export default class TorBoxClient extends BaseClient {
    private readonly baseUrl = getProxyUrl("https://api.torbox.app/v1/api");
    private readonly apiBaseUrl = "https://api.torbox.app/v1/api";

    // TorBox downloads on server, needs refresh for progress
    readonly refreshInterval = 10000;
    readonly supportsEphemeralLinks = false;

    constructor(user: User) {
        super({ user });
    }

    /**
     * Build a download URL for torrents or web downloads
     */
    private buildDownloadUrl(
        type: "torrent" | "webdl",
        id: string | number,
        fileId: string | number,
        redirect: boolean = true
    ): string {
        const endpoint = type === "torrent" ? "torrents/requestdl" : "webdl/requestdl";
        const idParam = type === "torrent" ? "torrent_id" : "web_id";
        return `${this.apiBaseUrl}/${endpoint}?token=${this.user.apiKey}&${idParam}=${id}&file_id=${fileId}&redirect=${redirect}`;
    }

    private async makeRequest<T>(
        path: string,
        options: RequestInit & { returnRaw?: boolean } = { returnRaw: false }
    ): Promise<T> {
        await this.rateLimiter.acquire();
        const { apiKey } = this.user;
        const url = `${this.baseUrl}${encodeURIComponent(`/${path}`)}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "User-Agent": USER_AGENT,
                ...options.headers,
            },
        });

        const data = await TorBoxClient.validateResponse<T>(response);
        return (options.returnRaw ? data : data.data) as T;
    }

    static async getUser(apiKey: string): Promise<User> {
        const response = await fetch(getProxyUrl("https://api.torbox.app/v1/api/user/me"), {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "User-Agent": USER_AGENT,
            },
        });

        const data = await TorBoxClient.validateResponse<TorBoxUser>(response);

        if (!data.data) {
            throw new DebridError("No user data returned", AccountType.TORBOX);
        }

        const user = data.data;
        const premiumExpiry = user.premium_expires_at ? new Date(user.premium_expires_at) : new Date();
        const isPremium = user.plan > 0 && premiumExpiry > new Date();

        return {
            id: `${AccountType.TORBOX}:${user.email}`,
            apiKey,
            type: AccountType.TORBOX,
            name: user.email,
            email: user.email,
            language: "en", // Default language
            isPremium,
            premiumExpiresAt: premiumExpiry,
        };
    }

    static async getAuthPin(): Promise<{
        pin: string;
        check: string;
        redirect_url: string;
    }> {
        // TorBox doesn't use PIN authentication like AllDebrid
        // For now, we'll return a placeholder that indicates to use API key directly
        return {
            pin: "TORBOX_API_KEY",
            check: "direct_api_key",
            redirect_url: "https://torbox.app/settings?section=account",
        };
    }

    static async validateAuthPin(pin: string, check: string): Promise<{ success: boolean; apiKey?: string }> {
        // Since TorBox uses direct API key authentication, we treat the "pin" as the API key
        if (check === "direct_api_key") {
            try {
                await this.getUser(pin);
                return {
                    success: true,
                    apiKey: pin,
                };
            } catch {
                return { success: false };
            }
        }
        return { success: false };
    }

    async getAccountDetails(): Promise<TorBoxAccountDetails> {
        const user = await this.makeRequest<TorBoxUser>("user/me?settings=true");
        const types = ["torrent", "usenet", "webdl"] as const;
        const [stats, ...usage] = await Promise.all([
            this.makeRequest<TorBoxStats>("user/stats?general=true&bandwidth=false").catch(() => null),
            ...types.map(async (type) => {
                if (type === "usenet" && user.plan !== 2 && TORBOX_PLANS[user.plan]) return { active: 0, queued: 0 };
                const endpoint = type === "torrent" ? "torrents" : type;
                const [active, queued] = await Promise.all([
                    this.makeRequest<unknown[]>(`${endpoint}/mylist?active=true&files=false&limit=1000`).catch(() => null),
                    this.makeRequest<unknown[]>(`queued/getqueued?type=${type}&limit=1000`).catch(() => null),
                ]);
                return { active: Array.isArray(active) ? active.length : null, queued: Array.isArray(queued) ? queued.length : null };
            }),
        ]);
        return normalizeTorBoxAccount(user, stats, usage);
    }

    override async addTorrent(uris: string[]): Promise<Record<string, DebridFileAddStatus>> {
        const nzbs = uris.filter((uri) => /\.nzb(?:[?#]|$)/i.test(uri));
        const results = await super.addTorrent(uris.filter((uri) => !nzbs.includes(uri)));
        await Promise.all(nzbs.map(async (uri) => {
            try {
                const item = await this.createUsenetDownload(uri);
                results[uri] = { success: true, id: `usenet:${item.usenetdownload_id}`, message: "NZB added", is_cached: false };
            } catch (error) {
                results[uri] = { success: false, message: error instanceof Error ? error.message : "NZB failed", is_cached: false };
            }
        }));
        return results;
    }

    async createUsenetDownload(input: string | File): Promise<{ usenetdownload_id: number; hash: string }> {
        const body = new FormData();
        if (typeof input === "string") body.append("link", input);
        else body.append("file", input);
        return this.makeRequest("usenet/createusenetdownload", { method: "POST", body });
    }

    async getUsenetList({ offset = 0, limit = 1000 } = {}): Promise<DebridFileList> {
        const data = await this.makeRequest<TorBoxUsenetDownload[]>(`usenet/mylist?offset=${offset}&limit=${limit}&files=true`);
        const files = (data ?? []).map(mapTorBoxUsenetItem);
        return { files, offset, limit, hasMore: files.length === limit };
    }

    async deleteUsenetDownload(id: string): Promise<void> {
        await this.makeRequest("usenet/controlusenetdownload", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usenet_id: Number(id.replace(/^usenet:/, "")), operation: "delete" }),
        });
    }

    async getTorrentList({ offset = 0, limit = 20, bypass_cache = true } = {}): Promise<DebridFileList> {
        // Fetch enough of each list to merge before slicing; independent endpoint offsets skip items.
        const count = offset + limit + 1;
        const [torrents, usenet] = await Promise.all([
            this.makeRequest<TorBoxTorrent[]>(`torrents/mylist?bypass_cache=${bypass_cache}&limit=${count}&files=true`),
            this.getUsenetList({ limit: count }).catch((error) => {
                if (error instanceof Error && /PLAN_RESTRICTED|upgrade your plan/i.test(error.message)) return { files: [] };
                throw error;
            }),
        ]);
        const merged = [...(torrents ?? []).map((torrent) => this.mapToDebridFile(torrent)), ...usenet.files]
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { files: merged.slice(offset, offset + limit), offset, limit, hasMore: merged.length > offset + limit };
    }

    async getDownloadProgress(hash: string): Promise<{ progress: number; state: string; finished: boolean } | null> {
        const torrents = await this.makeRequest<TorBoxTorrent[]>("torrents/mylist?bypass_cache=true&files=false&limit=1000");
        const torrent = torrents?.find((item) => item.hash.toLowerCase() === hash.toLowerCase());
        return torrent ? { progress: Math.min(100, Math.max(0, torrent.progress * 100)), state: torrent.download_state, finished: torrent.download_finished } : null;
    }

    async findTorrents(searchQuery: string): Promise<DebridFile[]> {
        // Optimized paginated search with early exit - reduces memory from 1000 items to 100-200 items
        if (!searchQuery.trim()) {
            return (await this.getTorrentList({ limit: 100 })).files;
        }

        const results: DebridFile[] = [];
        let offset = 0;
        const limit = 100;
        const maxResults = 100;

        while (results.length < maxResults) {
            const { files, hasMore } = await this.getTorrentList({ offset, limit });
            const matches = files.filter((file) => file.name.toLowerCase().includes(searchQuery.toLowerCase()));
            results.push(...matches);

            if (!hasMore || results.length >= maxResults) {
                break;
            }
            offset += limit;
        }

        return results.slice(0, maxResults);
    }

    async findTorrentById(torrentId: string): Promise<DebridFile | null> {
        try {
            if (torrentId.startsWith("usenet:")) {
                const item = await this.makeRequest<TorBoxUsenetDownload>(`usenet/mylist?id=${torrentId.slice(7)}`);
                return mapTorBoxUsenetItem(item);
            }
            const torrent = await this.makeRequest<TorBoxTorrent>(`torrents/mylist?id=${torrentId}`);
            return this.mapToDebridFile(torrent);
        } catch {
            return null;
        }
    }

    async getDownloadLink({
        fileNode,
        resolve = false,
    }: {
        fileNode: DebridFileNode;
        resolve?: boolean;
    }): Promise<DebridLinkInfo> {
        if (fileNode.id.startsWith("usenet:")) {
            const [, id, fileId] = fileNode.id.split(":");
            const link = await this.requestUsenetLink(id, fileId);
            return { link, name: fileNode.name, size: fileNode.size || 0, streamingLinks: await this.getStreamingLinks(fileNode.id, fileNode) };
        }
        const [torrentId, targetFileId] = fileNode.id.split(":");

        if (!torrentId || !targetFileId) {
            throw new DebridError("Invalid file ID format. Expected 'torrentId:fileId'", AccountType.TORBOX);
        }

        let downloadUrl: string;
        if (resolve) {
            downloadUrl = await this.getResolvedDownloadLink(torrentId, targetFileId);
        } else {
            downloadUrl = this.buildDownloadUrl("torrent", torrentId, targetFileId);
        }

        // Use file node's properties directly - no API call needed!
        return {
            link: downloadUrl,
            name: fileNode.name,
            size: fileNode.size || 0,
            streamingLinks: await this.getStreamingLinks(fileNode.id, fileNode),
        };
    }

    async requestUsenetLink(id: string, fileId: string): Promise<string> {
        return this.makeRequest(`usenet/requestdl?token=${encodeURIComponent(this.user.apiKey)}&usenet_id=${id}&file_id=${fileId}&redirect=false`);
    }

    async getStreamingLinks(id: string, fileNode?: DebridFileNode): Promise<Record<string, string>> {
        const parts = (fileNode?.id || id).split(":");
        const type = parts[0] === "usenet" ? "usenet" : "torrent";
        const [torrentId, fileId] = type === "usenet" ? parts.slice(1) : parts;
        if (!torrentId || !fileId) return {};
        // Failures reject so they aren't cached; the next attempt retries.
        return cached(streamLinksCache, `${this.user.apiKey}:${type}:${torrentId}:${fileId}`, STREAM_TTL_MS, async () => {
            let info = await this.createStream(torrentId, fileId, {}, type);
            if (!info) throw new Error("No stream");
            // TorBox defaults to the first audio track (often a dub). Native HLS players
            // (iOS) only get that one track, so request the user's language up front.
            const audioIndex = pickPreferredAudio(info, useSettingsStore.getState().settings.streaming.preferredLanguage);
            if (audioIndex != null) info = (await info.switchVariant({ audioIndex })) ?? info;
            return { apple: info.hlsUrl };
        }).catch(() => ({}));
    }

    /**
     * Create a TorBox web-stream session (Pro only). The response carries an
     * HLS url that TorBox transcodes server-side, plus real codec metadata.
     * Docs: https://api-docs.torbox.app -> Stream -> Create Stream.
     */
    async createStream(torrentId: string, fileId: string, opts: StreamVariantOptions = {}, type: "torrent" | "usenet" = "torrent"): Promise<StreamInfo | null> {
        const params = new URLSearchParams({ id: torrentId, file_id: fileId, type });
        if (opts.audioIndex != null) params.set("chosen_audio_index", String(opts.audioIndex));
        if (opts.resolutionIndex != null) params.set("chosen_resolution_index", String(opts.resolutionIndex));
        try {
            const data = await this.makeRequest<TorBoxStreamData>(`stream/createstream?${params}`);
            if (!data?.hls_url) return null;
            const info = this.toStreamInfo(data, torrentId, fileId, type);
            registerStreamInfo(info);
            return info;
        } catch (error) {
            // Web streaming is Pro-only; stop treating this account as transcode-capable.
            if (String(error).includes("PLAN_RESTRICTED") || String(error).toLowerCase().includes("upgrade your plan")) {
                setProviderTranscodeAvailable(false);
            }
            console.warn("[TorBox] createstream failed:", error);
            return null;
        }
    }

    private toStreamInfo(data: TorBoxStreamData, torrentId: string, fileId: string, type: "torrent" | "usenet"): StreamInfo {
        const video = data.metadata?.video;
        const height = video?.height || undefined;
        const resolutions: StreamResolution[] = [
            { index: null, label: height ? `Original (${height}p)` : "Original", height: height ?? null },
            ...TORBOX_RESOLUTIONS.filter((r) => !height || (r.height ?? 0) < height),
        ];
        return {
            provider: "torbox",
            hlsUrl: data.hls_url!,
            videoCodec: video?.codec,
            width: video?.width,
            height,
            audios: (data.metadata?.audios ?? []).map((a, i) => ({
                index: i,
                codec: a.codec,
                language: a.language_full || a.language,
                title: a.title,
                channels: a.channels,
                isDefault: a.default,
            })),
            audioIndex: data.audio_index ?? 0,
            resolutionIndex: data.resolution_index ?? null,
            resolutions,
            needsTranscoding: data.needs_transcoding,
            switchVariant: (next) =>
                this.createStream(torrentId, fileId, {
                    audioIndex: next.audioIndex ?? data.audio_index ?? 0,
                    resolutionIndex: next.resolutionIndex === undefined ? (data.resolution_index ?? null) : next.resolutionIndex,
                }, type),
        };
    }

    private getLibrary(fresh = false): Promise<TorBoxTorrent[]> {
        if (fresh) libraryCache.delete(this.user.apiKey);
        return cached(libraryCache, this.user.apiKey, LIBRARY_TTL_MS, async () => {
            const torrents = await this.makeRequest<TorBoxTorrent[]>("torrents/mylist?bypass_cache=true&limit=1000");
            return Array.isArray(torrents) ? torrents : [];
        });
    }

    /**
     * Map an addon source to a file in the user's TorBox library. Debrid-configured
     * addons redirect straight to the CDN, so the URL has no torrent/file ids; match
     * by info hash, then the addon's exact byte size, then the exact file name.
     */
    private findFile(torrents: TorBoxTorrent[], hint: StreamHint, urlName?: string): { torrentId: string; fileId: string } | null {
        const names = [hint.fileName, urlName].filter(Boolean).map((n) => baseName(n!));
        const pick = (files: TorBoxFile[]) =>
            (hint.fileSize ? files.find((f) => f.size === hint.fileSize) : undefined) ??
            files.find((f) => names.includes(baseName(f.short_name || f.name)));
        const result = (t: TorBoxTorrent, f: TorBoxFile) => ({ torrentId: String(t.id), fileId: String(f.id) });

        const hash = hint.infoHash?.toLowerCase();
        const byHash = hash ? torrents.find((t) => t.hash?.toLowerCase() === hash && t.files?.length) : undefined;
        if (byHash) {
            const files = byHash.files!;
            const match = pick(files);
            if (match) return result(byHash, match);
            const videos = files.filter((f) => VIDEO_FILE.test(f.name));
            if (videos.length === 1) return result(byHash, videos[0]);
            // Season pack: the episode's SxxEyy / 3x02 tag. Never "largest file" — wrong episode.
            if (hint.season != null && hint.episode != null) {
                const tag = new RegExp(`(?:s0*${hint.season}[ ._-]?e0*${hint.episode}|\\b${hint.season}x0*${hint.episode})(?!\\d)`, "i");
                const episodes = videos.filter((f) => tag.test(baseName(f.short_name || f.name)));
                if (episodes.length >= 1) return result(byHash, episodes.reduce((a, b) => (b.size > a.size ? b : a)));
            }
            return null;
        }
        if (!hint.fileSize && names.length === 0) return null;
        for (const t of torrents) {
            const match = t.files?.length ? pick(t.files) : undefined;
            if (match) return result(t, match);
        }
        return null;
    }

    /**
     * Streaming links for an addon-resolved URL: either a TorBox API url with
     * torrent_id/file_id, or a CDN url matched back to the user's library.
     */
    override async getStreamingLinksFromUrl(url: string, hint: StreamHint = {}): Promise<Record<string, string>> {
        try {
            const parsed = url ? new URL(url) : null;
            if (parsed?.hostname.includes("torbox")) {
                const torrentId = parsed.searchParams.get("torrent_id");
                const fileId = parsed.searchParams.get("file_id");
                if (torrentId && fileId) return this.getStreamingLinks(`${torrentId}:${fileId}`);
            }
            if (!hint.infoHash && !hint.fileName && !hint.fileSize) return {};
            const urlName = parsed?.pathname.split("/").pop();
            // The addon may have added the torrent moments ago — retry once on a fresh listing.
            let match =
                this.findFile(await this.getLibrary(), hint, urlName) ??
                this.findFile(await this.getLibrary(true), hint, urlName);
            // Cached on TorBox but not in this account (Comet/AIOStreams don't always add it):
            // add it ourselves — instant for cached torrents — and match inside it.
            if (!match && hint.infoHash) match = await this.addAndFind(hint, urlName);
            return match ? this.getStreamingLinks(`${match.torrentId}:${match.fileId}`) : {};
        } catch (error) {
            console.warn("[TorBox] stream lookup failed:", error);
            return {};
        }
    }

    /** Which info hashes TorBox has cached right now (instant to play / convert). */
    async checkCached(hashes: string[]): Promise<Set<string>> {
        const cached = new Set<string>();
        for (let i = 0; i < hashes.length; i += 100) {
            const batch = hashes.slice(i, i + 100).join(",");
            const data = await this.makeRequest<{ hash: string }[] | null>(
                `torrents/checkcached?hash=${batch}&format=list&list_files=false`
            );
            for (const t of data ?? []) if (t.hash) cached.add(t.hash.toLowerCase());
        }
        return cached;
    }

    private async addAndFind(hint: StreamHint, urlName?: string): Promise<{ torrentId: string; fileId: string } | null> {
        // Once per torrent: lookups retry, and an uncached torrent stays "checking" for a while.
        const key = `${this.user.apiKey}:${hint.infoHash!.toLowerCase()}`;
        if (addedTorrents.has(key)) return null;
        addedTorrents.add(key);
        const added = Object.values(await this.addMagnetLinks([`magnet:?xt=urn:btih:${hint.infoHash}`]))[0];
        if (!added?.success || !added.id) return null;
        libraryCache.delete(this.user.apiKey);
        // Just this torrent — files are listed immediately when it was already cached.
        const torrent = await this.makeRequest<TorBoxTorrent | TorBoxTorrent[]>(`torrents/mylist?id=${added.id}&bypass_cache=true`);
        return this.findFile([torrent].flat(), hint, urlName);
    }

    private async getResolvedDownloadLink(torrentId: string, targetFileId: string): Promise<string> {
        return this.makeRequest<string>(
            `torrents/requestdl?token=${this.user.apiKey}&torrent_id=${torrentId}&file_id=${targetFileId}&redirect=false`,
            { method: "GET" }
        );
    }

    async getTorrentFiles(torrentId: string): Promise<DebridNode[]> {
        if (torrentId.startsWith("usenet:")) return (await this.findTorrentById(torrentId))?.files ?? [];
        // For TorBox, files should already be available in DebridFile.files
        // This method exists only for backward compatibility
        // Make direct API request as fallback since this should rarely be called
        const torrent = await this.makeRequest<TorBoxTorrent>(`torrents/mylist?id=${torrentId}`);
        return this.mapToDebridFile(torrent).files || [];
    }

    async removeTorrent(torrentId: string): Promise<string> {
        if (torrentId.startsWith("usenet:")) {
            await this.deleteUsenetDownload(torrentId);
            return "Usenet download removed successfully";
        }
        const payload = {
            torrent_id: torrentId,
            operation: "delete",
        };

        await this.makeRequest<Record<string, unknown>>("torrents/controltorrent", {
            method: "POST",
            body: JSON.stringify(payload),
            headers: {
                "Content-Type": "application/json",
            },
        });

        return "Torrent removed successfully";
    }

    async restartTorrents(torrentIds: string[]): Promise<Record<string, OperationResult>> {
        const promises = torrentIds.map(async (torrentId) => {
            try {
                if (torrentId.startsWith("usenet:")) throw new Error("Usenet downloads cannot be resumed");
                const payload = {
                    torrent_id: torrentId,
                    operation: "resume",
                };

                await this.makeRequest<Record<string, unknown>>("torrents/controltorrent", {
                    method: "POST",
                    body: JSON.stringify(payload),
                    headers: {
                        "Content-Type": "application/json",
                    },
                });

                return { torrentId, success: true, message: "Torrent restarted successfully" };
            } catch (error) {
                return {
                    torrentId,
                    success: false,
                    message: error instanceof Error ? error.message : "Failed to restart torrent",
                };
            }
        });

        const results = await Promise.allSettled(promises);

        return torrentIds.reduce(
            (acc, torrentId, index) => {
                const result = results[index];
                if (result.status === "fulfilled") {
                    acc[torrentId] = { success: result.value.success, message: result.value.message };
                } else {
                    acc[torrentId] = { success: false, message: result.reason?.message || "Failed to restart torrent" };
                }
                return acc;
            },
            {} as Record<string, OperationResult>
        );
    }

    async addMagnetLinks(magnetUris: string[]): Promise<Record<string, DebridFileAddStatus>> {
        // Parallelize magnet link additions for 10x faster bulk operations
        const promises = magnetUris.map(async (magnet) => {
            try {
                const formData = new FormData();
                formData.append("magnet", magnet);
                formData.append("seed", "0");
                formData.append("allow_zip", "true");

                const response = await this.makeRequest<{
                    data: { torrent_id?: number; hash?: string; auth_id?: string };
                    detail: string;
                }>("torrents/createtorrent", {
                    method: "POST",
                    body: formData,
                    returnRaw: true,
                });

                return {
                    magnet,
                    status: {
                        success: true,
                        id: response.data.torrent_id,
                        message: "Torrent added successfully",
                        is_cached: response.detail.toLowerCase().includes("cached"),
                    } as DebridFileAddStatus,
                };
            } catch (error) {
                return {
                    magnet,
                    status: {
                        success: false,
                        message: error instanceof Error ? error.message : "Failed to add torrent",
                        is_cached: false,
                    } as DebridFileAddStatus,
                };
            }
        });

        const results = await Promise.allSettled(promises);

        return magnetUris.reduce(
            (acc, magnet, index) => {
                const result = results[index];
                if (result.status === "fulfilled") {
                    acc[magnet] = result.value.status;
                } else {
                    acc[magnet] = {
                        success: false,
                        message: result.reason?.message || "Failed to add torrent",
                        is_cached: false,
                    };
                }
                return acc;
            },
            {} as Record<string, DebridFileAddStatus>
        );
    }

    async uploadTorrentFiles(files: File[]): Promise<Record<string, DebridFileAddStatus>> {
        // Parallelize torrent file uploads for 10x faster bulk operations
        const promises = files.map(async (file) => {
            try {
                if (/\.nzb$/i.test(file.name)) {
                    const response = await this.createUsenetDownload(file);
                    return { fileName: file.name, status: { success: true, id: `usenet:${response.usenetdownload_id}`, message: "NZB uploaded", is_cached: false } as DebridFileAddStatus };
                }
                const formData = new FormData();
                formData.append("file", file);
                formData.append("seed", "0");
                formData.append("allow_zip", "true");

                const response = await this.makeRequest<{ torrent_id?: number; id?: number; cached?: boolean }>(
                    "torrents/createtorrent",
                    {
                        method: "POST",
                        body: formData,
                    }
                );

                return {
                    fileName: file.name,
                    status: {
                        success: true,
                        id: response.torrent_id || response.id,
                        message: "Torrent file uploaded successfully",
                        is_cached: response.cached || false,
                    } as DebridFileAddStatus,
                };
            } catch (error) {
                return {
                    fileName: file.name,
                    status: {
                        success: false,
                        message: error instanceof Error ? error.message : "Failed to upload torrent file",
                        is_cached: false,
                    } as DebridFileAddStatus,
                };
            }
        });

        const results = await Promise.allSettled(promises);

        return files.reduce(
            (acc, file, index) => {
                const result = results[index];
                if (result.status === "fulfilled") {
                    acc[file.name] = result.value.status;
                } else {
                    acc[file.name] = {
                        success: false,
                        message: result.reason?.message || "Failed to upload torrent file",
                        is_cached: false,
                    };
                }
                return acc;
            },
            {} as Record<string, DebridFileAddStatus>
        );
    }

    async searchTorrents(query: string): Promise<TorBoxSearchResult[]> {
        // Use different base URL for search API (search-api.torbox.app vs api.torbox.app)
        const searchApiUrl = getProxyUrl(`https://search-api.torbox.app/torrents/search/${encodeURIComponent(query)}`);

        const params = new URLSearchParams({
            check_cache: "true",
            check_owned: "true",
            search_user_engines: "true",
        });

        const response = await fetch(`${searchApiUrl}?${params}`, {
            headers: {
                Authorization: `Bearer ${this.user.apiKey}`,
                "User-Agent": USER_AGENT,
            },
        });

        const data = await TorBoxClient.validateResponse<TorBoxSearchResponse["data"]>(response);
        return data.data?.torrents || [];
    }

    // Web download methods
    async addWebDownloads(links: string[]): Promise<WebDownloadAddResult[]> {
        const results = await Promise.allSettled(
            links.map(async (link) => {
                const formData = new FormData();
                formData.append("link", link);

                const response = await this.makeRequest<{
                    data: { webdownload_id?: number; hash?: string };
                    detail: string;
                }>("webdl/createwebdownload", {
                    method: "POST",
                    body: formData,
                    returnRaw: true,
                });

                return {
                    link,
                    success: true,
                    id: response.data.webdownload_id?.toString(),
                    name: link.split("/").pop() || link,
                };
            })
        );

        return results.map((result, index) => {
            if (result.status === "fulfilled") {
                return result.value;
            }
            return {
                link: links[index],
                success: false,
                error: result.reason?.message || "Failed to add link",
            };
        });
    }

    async getWebDownloadList({ offset, limit }: { offset: number; limit: number }): Promise<WebDownloadList> {
        const data = await this.makeRequest<TorBoxWebDownload[]>(`webdl/mylist?offset=${offset}&limit=${limit}`);
        const downloads = Array.isArray(data) ? data : [];

        return {
            downloads: downloads.map((dl) => this.mapToWebDownload(dl)),
            offset,
            limit,
            hasMore: downloads.length === limit,
        };
    }

    async deleteWebDownload(id: string): Promise<void> {
        await this.makeRequest("webdl/controlwebdownload", {
            method: "POST",
            body: JSON.stringify({ operation: "delete", webdl_id: parseInt(id) }),
            headers: {
                "Content-Type": "application/json",
            },
        });
    }

    private mapToWebDownload(dl: TorBoxWebDownload): WebDownload {
        const isReady = dl.download_finished && dl.download_present;
        const downloadLink = isReady ? this.buildDownloadUrl("webdl", dl.id, 0) : undefined;

        return {
            id: dl.id.toString(),
            name: dl.name,
            originalLink: dl.original_url,
            downloadLink,
            size: dl.size || undefined,
            status: this.mapWebDownloadStatus(dl.download_state, dl.download_finished),
            progress: dl.progress * 100,
            createdAt: new Date(dl.created_at),
            error: dl.error || undefined,
        };
    }

    private mapWebDownloadStatus(state: string, finished: boolean): WebDownloadStatus {
        if (finished) return "completed";
        const stateLower = state.toLowerCase();
        if (stateLower === "downloading" || stateLower === "metadl") return "processing";
        if (stateLower === "cached" || stateLower === "completed") return "completed";
        if (stateLower === "error" || stateLower === "failed") return "failed";
        if (stateLower === "pending" || stateLower === "queued") return "pending";
        return "processing";
    }

    private mapToDebridFile(torrent: TorBoxTorrent): DebridFile {
        const status: DebridFileStatus = this.mapTorrentStatus(torrent);

        // Map files if they exist in the torrent response
        const files: DebridFileNode[] | undefined = torrent.files
            ? torrent.files.map(
                (file): DebridFileNode => ({
                    id: `${torrent.id}:${file.id}`,
                    name: file.short_name || file.name,
                    size: file.size,
                    type: "file",
                    children: [],
                })
            )
            : undefined;

        return {
            id: torrent.id.toString(),
            name: torrent.name,
            size: Math.max(torrent.size, 0),
            status,
            progress: torrent.progress * 100,
            downloadSpeed: torrent.download_speed,
            uploadSpeed: torrent.upload_speed,
            peers: torrent.peers + torrent.seeds,
            createdAt: new Date(torrent.created_at),
            completedAt: torrent.cached_at ? new Date(torrent.cached_at) : undefined,
            files,
        };
    }

    private mapTorrentStatus(torrent: TorBoxTorrent): DebridFileStatus {
        const downloadState = torrent.download_state.toLowerCase();

        switch (downloadState) {
            case "downloading":
            case "metadl":
                return torrent.cached ? "completed" : "downloading";
            case "seeding":
            case "uploading":
            case "uploading (no peers)":
                if (torrent.active) {
                    return torrent.download_present ? "seeding" : "processing";
                } else {
                    return "completed";
                }
            case "cached":
            case "completed":
                return "completed";
            case "paused":
                return "paused";
            case "error":
            case "reported missing":
                return "failed";
            case "checking":
            case "stalled (no seeds)":
                return "waiting";
            case "processing":
                return "processing";
            case "expired":
                return "inactive";
            default:
                console.log("Unknown download state:", downloadState);
                return "unknown";
        }
    }

    private static async validateResponse<T>(response: Response): Promise<TorBoxResponse<T>> {
        let data: TorBoxResponse<T>;
        try {
            data = await response.json();
        } catch {
            if (!response.ok) {
                if (response.status === 401) {
                    throw new DebridAuthError("Invalid or expired API key", AccountType.TORBOX);
                }
                if (response.status === 429) {
                    const retryAfter = response.headers.get("Retry-After");
                    throw new DebridRateLimitError(
                        "Rate limit exceeded",
                        AccountType.TORBOX,
                        retryAfter ? parseInt(retryAfter) : undefined
                    );
                }
                throw new DebridError(`API request failed: ${response.statusText}`, AccountType.TORBOX);
            }
            throw new DebridError("Invalid JSON response", AccountType.TORBOX);
        }

        // API response errors (works for both ok and non-ok responses)
        if (!data.success) {
            const errorCode = data.error || "";
            const errorMessage = data.detail || "Unknown error";

            if (errorCode === "AUTH_ERROR" || errorMessage.toLowerCase().includes("token") || response.status === 401) {
                throw new DebridAuthError(errorMessage, AccountType.TORBOX);
            }

            if (
                errorCode === "RATE_LIMIT" ||
                errorMessage.toLowerCase().includes("rate limit") ||
                response.status === 429
            ) {
                const retryAfter = response.headers.get("Retry-After");
                throw new DebridRateLimitError(
                    errorMessage,
                    AccountType.TORBOX,
                    retryAfter ? parseInt(retryAfter) : undefined
                );
            }

            throw new DebridError(`${errorCode}: ${errorMessage}`, AccountType.TORBOX);
        }

        return data;
    }
}
