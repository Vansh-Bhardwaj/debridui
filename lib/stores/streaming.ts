import { create } from "zustand";
import { type AddonSource, type AddonSubtitle, type TvSearchParams, type AddonManifest, addonSupportsStreams, addonSupportsSubtitles } from "@/lib/addons/types";
import { getSubtitleLabel, isSubtitleLanguage } from "@/lib/utils/subtitles";
import { AddonClient } from "@/lib/addons/client";
import { parseStreams } from "@/lib/addons/parser";
import { selectBestSource } from "@/lib/streaming/source-selector";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import { FileType, MediaPlayer } from "@/lib/types";
import { openInPlayer } from "@/lib/utils/media-player";
import { useSettingsStore, QUALITY_PROFILES, type StreamingSettings, type PlaybackSettings } from "./settings";
import { usePreviewStore } from "./preview";
import type { ProgressKey } from "@/hooks/use-progress";
import { createDevTimer } from "@/lib/utils/dev-timing";

export interface StreamingRequest {
    imdbId: string;
    type: "movie" | "show";
    title: string;
    tvParams?: TvSearchParams;
}

export interface EpisodeContext {
    imdbId: string;
    title: string;
    season: number;
    episode: number;
    totalEpisodes?: number;
    totalSeasons?: number;
}

export interface PreloadedData {
    source: AddonSource;
    subtitles: AddonSubtitle[];
    title: string;
    season: number;
    episode: number;
    imdbId: string;
}

interface StreamingState {
    activeRequest: StreamingRequest | null;
    selectedSource: AddonSource | null;
    allFetchedSources: AddonSource[];
    episodeContext: EpisodeContext | null;

    // Source picker
    sourcePickerOpen: boolean;
    pendingPlayContext: { displayTitle: string; subtitles: AddonSubtitle[]; progressKey: ProgressKey | null } | null;
    openSourcePicker: () => void;
    closeSourcePicker: () => void;
    playAlternativeSource: (source: AddonSource) => void;

    // Preloading
    preloadedData: PreloadedData | null;
    preloadNextEpisode: (addons: { id: string; url: string; name: string }[]) => Promise<void>;

    play: (request: StreamingRequest, addons: { id: string; url: string; name: string }[], options?: { forceAutoPlay?: boolean }) => Promise<void>;
    playSource: (source: AddonSource, title: string, options?: { subtitles?: AddonSubtitle[]; progressKey?: ProgressKey }) => Promise<void>;
    playNextEpisode: (addons: { id: string; url: string; name: string }[], options?: { forceAutoPlay?: boolean }) => Promise<void>;
    playPreviousEpisode: (addons: { id: string; url: string; name: string }[], options?: { forceAutoPlay?: boolean }) => Promise<void>;
    setEpisodeContext: (context: EpisodeContext | null) => void;
    cancel: () => void;
    dismiss: () => void;
    getProgressKey: () => ProgressKey | null;
}

// Module-level state for request cancellation and toast timing
let toastId: string | number | null = null;
let toastCreatedAt = 0;
let requestId = 0;
let preloadRequestId = 0;

type ResolvedStreamCacheEntry = {
    url: string;
    chain?: string[];
    cachedAt: number;
};

const resolvedStreamCache = new Map<string, ResolvedStreamCacheEntry>();
const inflightResolvedStreamRequests = new Map<string, Promise<{ url: string; chain?: string[] }>>();
const RESOLVED_STREAM_CACHE_TTL_MS = 2 * 60 * 1000;
const RESOLVED_STREAM_CACHE_MAX_SIZE = 200;

// Minimum time toast must be visible before dismissing (allows mount animation)
const MIN_TOAST_DURATION = 300;
const TOAST_POSITION = "bottom-center" as const;

const MAX_QUALITY_RANGE = QUALITY_PROFILES.find((p) => p.id === "max-quality")!.range;

/**
 * Get effective streaming settings — when targeting a remote device,
 * use its streaming prefs so source selection matches what that device
 * would pick if it auto-played locally.
 */
async function getEffectiveStreamingSettings(): Promise<StreamingSettings> {
    const localSettings = useSettingsStore.getState().get("streaming");
    const { useDeviceSyncStore } = await import("@/lib/stores/device-sync");
    const { activeTarget, devices } = useDeviceSyncStore.getState();
    if (!activeTarget) return localSettings;

    // Find the target device's streaming prefs
    const target = devices.find((d) => d.id === activeTarget);
    const prefs = target?.streamingPrefs;
    if (!prefs) {
        // Target connected before this feature — fall back to max quality
        return { ...localSettings, profileId: "max-quality", customRange: MAX_QUALITY_RANGE };
    }

    // Build StreamingSettings from the target device's prefs
    const profileId = (QUALITY_PROFILES.some((p) => p.id === prefs.profileId) || prefs.profileId === "custom")
        ? prefs.profileId as StreamingSettings["profileId"]
        : localSettings.profileId;

    return {
        ...localSettings,
        profileId,
        customRange: prefs.customRange
            ? {
                minResolution: prefs.customRange.minResolution as StreamingSettings["customRange"]["minResolution"],
                maxResolution: prefs.customRange.maxResolution as StreamingSettings["customRange"]["maxResolution"],
                minSourceQuality: prefs.customRange.minSourceQuality as StreamingSettings["customRange"]["minSourceQuality"],
                maxSourceQuality: prefs.customRange.maxSourceQuality as StreamingSettings["customRange"]["maxSourceQuality"],
            }
            : localSettings.customRange,
        allowUncached: prefs.allowUncached,
        preferredLanguage: prefs.preferredLanguage,
        preferCached: prefs.preferCached,
    };
}

type SubtitleQueryResult = {
    addonName: string;
    subtitles: AddonSubtitle[];
};

function combineSubtitles(results: SubtitleQueryResult[]): AddonSubtitle[] {
    const preferredLang = (useSettingsStore.getState().get("playback") as PlaybackSettings).subtitleLanguage || "english";
    const byKey = new Map<string, AddonSubtitle>();

    for (const { addonName, subtitles } of results) {
        if (!subtitles) continue;

        for (const sub of subtitles) {
            if (!sub?.url || !sub.lang) continue;
            if (!isSubtitleLanguage(sub, preferredLang)) continue;

            const key = `${sub.lang}:${sub.url}`;
            if (!byKey.has(key)) {
                byKey.set(key, {
                    ...sub,
                    name: getSubtitleLabel(sub, addonName),
                });
            }
        }
    }

    return Array.from(byKey.values());
}

// Helper to extract clean show title
const cleanShowTitle = (title: string): string => {
    // Matches "Show Name S01E01" or "Show Name S01 E01" etc, taking the first part
    const match = title.match(/^(.*?)(?:\s+S\d{1,2}\s*E\d{1,2})/i);
    return match ? match[1] : title;
};

function dismissToast() {
    if (!toastId) return;

    const elapsed = Date.now() - toastCreatedAt;
    const id = toastId;
    toastId = null;

    if (elapsed < MIN_TOAST_DURATION) {
        setTimeout(() => toast.dismiss(id), MIN_TOAST_DURATION - elapsed);
    } else {
        toast.dismiss(id);
    }
}

type AddonInfo = { id: string; url: string; name: string };

/**
 * Classify addons into stream-capable and subtitle-capable using cached manifests.
 * Safe default: if manifest is unknown/failed, assume it supports streams (no regression).
 */
async function classifyAddons(addons: AddonInfo[]): Promise<{ streamAddons: AddonInfo[]; subtitleAddons: AddonInfo[] }> {
    const manifests = await Promise.all(
        addons.map(async (addon): Promise<AddonManifest | null> => {
            try {
                return await queryClient.fetchQuery({
                    queryKey: ["addon", addon.id, "manifest"],
                    queryFn: async () => {
                        const client = new AddonClient({ url: addon.url });
                        return client.fetchManifest();
                    },
                    staleTime: 1000 * 60 * 60 * 24, // 24 hours
                });
            } catch {
                return null;
            }
        })
    );

    const streamAddons = addons.filter((_, i) => {
        const m = manifests[i];
        if (!m?.resources) return true; // unknown → include (safe default)
        return addonSupportsStreams(m);
    });

    const subtitleAddons = addons.filter((_, i) => {
        const m = manifests[i];
        if (!m?.resources) return false; // unknown → skip for subtitles (safe)
        return addonSupportsSubtitles(m);
    });

    return { streamAddons, subtitleAddons };
}

interface ShowSourceToastParams {
    source: AddonSource;
    title: string;
    isCached: boolean;
    autoPlay: boolean;
    allowUncached: boolean;
    onPlay: () => void;
    otherSourcesCount?: number;
    onPickSource?: () => void;
}

/**
 * Resolve an addon stream URL server-side by following redirect chains.
 * Many addons (Torrentio, Comet, MediaFusion, etc.) return proxy URLs
 * that redirect to the actual debrid download link.
 * Returns the resolved URL, or the original URL if resolution fails.
 */
async function resolveStreamUrl(url: string): Promise<{ url: string; chain?: string[] }> {
    if (typeof window === "undefined") return { url };

    const inflight = inflightResolvedStreamRequests.get(url);
    if (inflight) return inflight;

    const cached = resolvedStreamCache.get(url);
    if (cached && Date.now() - cached.cachedAt < RESOLVED_STREAM_CACHE_TTL_MS) {
        return { url: cached.url, chain: cached.chain };
    }

    if (cached) {
        resolvedStreamCache.delete(url);
    }

    const resolvePromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch(`/api/addon/resolve?url=${encodeURIComponent(url)}`, {
                signal: controller.signal,
            });
            if (!res.ok) return { url };
            const data = (await res.json()) as { url?: string; status?: number; chain?: string[] };
            if (data.url && (data.status ?? 999) < 400) {
                const resolved = { url: data.url, chain: data.chain };
                resolvedStreamCache.set(url, { ...resolved, cachedAt: Date.now() });

                if (resolvedStreamCache.size > RESOLVED_STREAM_CACHE_MAX_SIZE) {
                    const oldestKey = resolvedStreamCache.keys().next().value;
                    if (oldestKey) resolvedStreamCache.delete(oldestKey);
                }

                return resolved;
            }
            return { url };
        } catch {
            return { url };
        } finally {
            clearTimeout(timeout);
            inflightResolvedStreamRequests.delete(url);
        }
    })();

    inflightResolvedStreamRequests.set(url, resolvePromise);
    return resolvePromise;
}

function showSourceToast({ source, title, isCached, autoPlay, allowUncached, onPlay, otherSourcesCount, onPickSource }: ShowSourceToastParams) {
    if (autoPlay && (isCached || allowUncached)) {
        dismissToast();
        onPlay();
        return;
    }

    const meta = [source.resolution, source.quality, source.size].filter(Boolean).join(" · ");
    const cacheStatus = isCached ? "Cached" : "Not cached";
    const description = `${meta} · ${cacheStatus}`.replace(/^ · /, "");

    const cancelObj = otherSourcesCount && otherSourcesCount > 0 && onPickSource
        ? { label: `${otherSourcesCount} more`, onClick: onPickSource }
        : undefined;

    if (isCached || allowUncached) {
        toast.success(title, {
            id: toastId ?? undefined,
            position: TOAST_POSITION,
            description,
            action: { label: "Play", onClick: onPlay },
            cancel: cancelObj,
            duration: Infinity,
        });
    } else {
        toast.warning(title, {
            id: toastId ?? undefined,
            position: TOAST_POSITION,
            description,
            action: { label: "Play Anyway", onClick: onPlay },
            cancel: cancelObj,
            duration: Infinity,
        });
    }
}

export const useStreamingStore = create<StreamingState>()((set, get) => ({
    activeRequest: null,
    selectedSource: null,
    allFetchedSources: [],
    episodeContext: null,
    preloadedData: null,

    // Source picker
    sourcePickerOpen: false,
    pendingPlayContext: null,
    openSourcePicker: () => set({ sourcePickerOpen: true }),
    closeSourcePicker: () => set({ sourcePickerOpen: false }),
    playAlternativeSource: (source) => {
        const { pendingPlayContext, playSource } = get();
        if (!pendingPlayContext) return;
        set({ sourcePickerOpen: false, selectedSource: source });
        playSource(source, pendingPlayContext.displayTitle, {
            subtitles: pendingPlayContext.subtitles.length > 0 ? pendingPlayContext.subtitles : undefined,
            progressKey: pendingPlayContext.progressKey ?? undefined,
        });
    },

    setEpisodeContext: (context) => {
        if (context) {
            context.title = cleanShowTitle(context.title);
        }
        set({ episodeContext: context });
    },

    getProgressKey: () => {
        const { activeRequest } = get();
        if (!activeRequest) return null;

        if (activeRequest.type === "show" && activeRequest.tvParams) {
            return {
                imdbId: activeRequest.imdbId,
                type: "show" as const,
                season: activeRequest.tvParams.season,
                episode: activeRequest.tvParams.episode,
            };
        }

        if (activeRequest.type === "movie") {
            return {
                imdbId: activeRequest.imdbId,
                type: "movie" as const,
            };
        }

        return null;
    },

    playSource: async (source, title, options) => {
        if (!source.url) return;

        // Build descriptive filename with source metadata
        const meta = [source.resolution, source.quality, source.size].filter(Boolean).join(" ");
        const fileName = meta ? `${title} [${meta}]` : title;

        // ── Device Sync interception ───────────────────────────────────
        // If a remote device is selected as the playback target, send
        // the content there instead of playing locally.
        const { useDeviceSyncStore } = await import("@/lib/stores/device-sync");
        const syncStore = useDeviceSyncStore.getState();

        const mediaPlayer = useSettingsStore.getState().get("mediaPlayer");

        // For browser playback, open the preview dialog immediately (loading state)
        // before resolving the URL, so the user sees instant feedback.
        if (mediaPlayer === MediaPlayer.BROWSER && !syncStore.activeTarget) {
            usePreviewStore.getState().openSinglePreview({
                url: "", // Empty → shows loading spinner in dialog
                title: fileName,
                fileType: FileType.VIDEO,
                subtitles: options?.subtitles,
                progressKey: options?.progressKey,
            });
        }

        // Resolve addon proxy/redirect URL to the actual debrid download link
        const resolved = await resolveStreamUrl(source.url);
        const playUrl = resolved.url;

        if (syncStore.playOnTarget({
            url: playUrl,
            title: fileName,
            imdbId: options?.progressKey?.imdbId,
            mediaType: options?.progressKey?.type,
            season: options?.progressKey?.season,
            episode: options?.progressKey?.episode,
            subtitles: options?.subtitles?.map((s) => ({ url: s.url, lang: s.lang, name: s.name })),
        })) {
            // Sent to remote device — close any loading preview
            usePreviewStore.getState().closePreview();
            return;
        }

        if (mediaPlayer === MediaPlayer.BROWSER) {
            // Preview is already open in loading state — just update the URL
            // Also pass the redirect chain so streaming links can be resolved
            // from intermediate debrid provider URLs (e.g. TorBox API with torrent_id)
            const previewStore = usePreviewStore.getState();
            previewStore.setDirectUrl(playUrl);
            if (resolved.chain?.length) {
                previewStore.setRedirectChain(resolved.chain);
            }
        } else {
            openInPlayer({ url: playUrl, fileName, player: mediaPlayer, subtitles: options?.subtitles?.map((s) => s.url), progressKey: options?.progressKey });
        }
    },

    play: async (request, addons, options) => {
        const forceAutoPlay = options?.forceAutoPlay ?? false;
        const timer = createDevTimer("streaming.play", {
            imdbId: request.imdbId,
            type: request.type,
            addonCount: addons.length,
        });
        // Clear preloaded data if we are playing something unrelated
        set({ preloadedData: null });

        const { imdbId, type, title: rawTitle, tvParams } = request;

        if (addons.length === 0) {
            toast.error("No addons enabled", {
                description: "Configure addons in settings to fetch sources",
            });
            return;
        }

        // Format title for episodes
        let displayTitle = rawTitle;
        if (type === "show" && tvParams) {
            const s = tvParams.season.toString().padStart(2, "0");
            const e = tvParams.episode.toString().padStart(2, "0");
            const seasonTag = `S${s}E${e}`;

            // If title matches "Show Name", append suffix. 
            if (cleanShowTitle(rawTitle) === rawTitle && !rawTitle.includes(seasonTag)) {
                displayTitle = `${rawTitle} ${seasonTag}`;
            }
        }

        // Cancel previous request: dismiss old toast and increment request ID
        dismissToast();
        const currentRequestId = ++requestId;

        set({ activeRequest: request, selectedSource: null, allFetchedSources: [] });

        // Set episode context if this is a show
        if (type === "show" && tvParams) {
            set({
                episodeContext: {
                    imdbId,
                    title: cleanShowTitle(rawTitle), // Store clean title for context
                    season: tvParams.season,
                    episode: tvParams.episode,
                },
            });
        } else {
            set({ episodeContext: null });
        }

        toastId = toast.loading("Finding best source...", {
            description: displayTitle,
            position: TOAST_POSITION,
            cancel: { label: "Cancel", onClick: () => get().cancel() },
        });
        toastCreatedAt = Date.now();

        try {
            // Classify addons by capability — only query addons for what they support
            const { streamAddons, subtitleAddons } = await classifyAddons(addons);
            timer.step("classified-addons", {
                streamAddons: streamAddons.length,
                subtitleAddons: subtitleAddons.length,
            });

            const sourcePromises = streamAddons.map(async (addon) => {
                const queryKey = ["addon", addon.id, "sources", imdbId, type, tvParams] as const;

                try {
                    // Use fetchQuery which respects staleTime — avoids serving
                    // stale cached data that may have fewer results
                    return await queryClient.fetchQuery({
                        queryKey,
                        queryFn: async () => {
                            const client = new AddonClient({ url: addon.url });
                            const response = await client.fetchStreams(imdbId, type, tvParams);
                            return parseStreams(response.streams, addon.id, addon.name);
                        },
                        staleTime: 3 * 60 * 1000, // 3 minutes
                        gcTime: 10 * 60 * 1000,   // match use-addons.ts
                    });
                } catch {
                    return [] as AddonSource[];
                }
            });

            // Fetch subtitles in parallel from subtitle-capable addons only
            const subtitlePromises = subtitleAddons.map(async (addon): Promise<SubtitleQueryResult> => {
                try {
                    const client = new AddonClient({ url: addon.url });
                    const response = await client.fetchSubtitles(imdbId, type, tvParams);
                    return { addonName: addon.name, subtitles: response.subtitles || [] };
                } catch {
                    return { addonName: addon.name, subtitles: [] };
                }
            });

            const [sourcesResults, subtitleResults] = await Promise.all([
                Promise.all(sourcePromises),
                Promise.all(subtitlePromises),
            ]);

            // Filter out old requests
            if (requestId !== currentRequestId) return;

            const allSources = sourcesResults.flat();
            const subtitles = combineSubtitles(subtitleResults);
            timer.step("fetched-stream-data", {
                totalSources: allSources.length,
                subtitles: subtitles.length,
            });

            const streamingSettings = await getEffectiveStreamingSettings();
            const result = selectBestSource(allSources, streamingSettings);
            timer.step("selected-source", {
                hasMatches: result.hasMatches,
                cachedMatches: result.cachedMatches.length,
                uncachedMatches: result.uncachedMatches.length,
            });

            set({ allFetchedSources: result.allSorted, selectedSource: result.source });

            if (!result.hasMatches) {
                set({ activeRequest: null });
                toast.error("No sources found", {
                    id: toastId ?? undefined,
                    position: TOAST_POSITION,
                    description:
                        allSources.length > 0
                            ? "No sources match your quality preferences"
                            : "No sources available from enabled addons",
                });
                timer.end({ status: "no-match" });
                return;
            }

            const { playSource, getProgressKey } = get();
            const source = result.source!;
            const progressKey = getProgressKey();

            // Store context for source picker (alternative source selection)
            set({
                activeRequest: null,
                selectedSource: source,
                pendingPlayContext: { displayTitle, subtitles, progressKey },
            });

            showSourceToast({
                source,
                title: displayTitle,
                isCached: result.isCached,
                autoPlay: forceAutoPlay || streamingSettings.autoPlay,
                allowUncached: streamingSettings.allowUncached,
                onPlay: () =>
                    playSource(source, displayTitle, {
                        progressKey: progressKey ?? undefined,
                        subtitles: subtitles.length > 0 ? subtitles : undefined,
                    }),
                otherSourcesCount: result.allSorted.length - 1,
                onPickSource: () => set({ sourcePickerOpen: true }),
            });
            timer.end({ status: "ok", selectedCached: result.isCached });
        } catch (error) {
            console.error(error);
            if (requestId === currentRequestId) {
                toast.error("Failed to fetch streams", {
                    id: toastId ?? undefined,
                    description: "An unexpected error occurred",
                    position: TOAST_POSITION,
                });
                set({ activeRequest: null });
            }
            timer.end({ status: "error" });
        }
    },

    preloadNextEpisode: async (addons) => {
        const { episodeContext, preloadedData } = get();
        if (!episodeContext) return;

        // Prevent duplicate preloading
        const currentPreloadId = ++preloadRequestId;

        const nextEpisode = episodeContext.episode + 1;
        let targetSeason = episodeContext.season;
        let targetEpisode = nextEpisode;
        let targetTitle = episodeContext.title; // Initial guess

        // Don't preload if we already have data for this target
        if (preloadedData && preloadedData.season === targetSeason && preloadedData.episode === targetEpisode && preloadedData.imdbId === episodeContext.imdbId) {
            return;
        }

        try {
            // 1. Fetch Metadata (Title + verify existence)
            const { traktClient } = await import("@/lib/trakt");
            const episodes = await traktClient.getShowEpisodes(episodeContext.imdbId, targetSeason);

            if (targetEpisode > episodes.length) {
                targetSeason += 1;
                targetEpisode = 1;

                const nextSeasEpisodes = await traktClient.getShowEpisodes(episodeContext.imdbId, targetSeason);
                if (nextSeasEpisodes.length === 0) return; // End of show

                const epData = nextSeasEpisodes.find(e => e.number === 1);
                targetTitle = `${episodeContext.title} S${String(targetSeason).padStart(2, "0")}E01${epData?.title ? ` - ${epData.title}` : ""}`;
            } else {
                const epData = episodes.find(e => e.number === targetEpisode);
                targetTitle = `${episodeContext.title} S${String(targetSeason).padStart(2, "0")}E${String(targetEpisode).padStart(2, "0")}${epData?.title ? ` - ${epData.title}` : ""}`;
            }

            // 2. Classify addons by capability
            const { streamAddons, subtitleAddons } = await classifyAddons(addons);

            // 3. Fetch Streams (Background) — only from stream-capable addons
            const sourcePromises = streamAddons.map(async (addon) => {
                const queryKey = ["addon", addon.id, "sources", episodeContext.imdbId, "show", { season: targetSeason, episode: targetEpisode }] as const;
                try {
                    return await queryClient.fetchQuery({
                        queryKey,
                        queryFn: async () => {
                            const client = new AddonClient({ url: addon.url });
                            const response = await client.fetchStreams(episodeContext.imdbId, "show", { season: targetSeason, episode: targetEpisode });
                            return parseStreams(response.streams, addon.id, addon.name);
                        },
                        staleTime: 3 * 60 * 1000,
                        gcTime: 10 * 60 * 1000,
                    });
                } catch { return [] as AddonSource[]; }
            });

            const subtitlePromises = subtitleAddons.map(async (addon): Promise<SubtitleQueryResult> => {
                try {
                    const client = new AddonClient({ url: addon.url });
                    const response = await client.fetchSubtitles(episodeContext.imdbId, "show", { season: targetSeason, episode: targetEpisode });
                    return { addonName: addon.name, subtitles: response.subtitles || [] };
                } catch { return { addonName: addon.name, subtitles: [] }; }
            });

            const [sourcesResults, subtitleResults] = await Promise.all([
                Promise.all(sourcePromises),
                Promise.all(subtitlePromises),
            ]);

            if (preloadRequestId !== currentPreloadId) return;

            const allSources = sourcesResults.flat();
            const subtitles = combineSubtitles(subtitleResults);

            const streamingSettings = await getEffectiveStreamingSettings();
            const result = selectBestSource(allSources, streamingSettings);

            if (result.source) {
                set({
                    preloadedData: {
                        source: result.source,
                        subtitles: subtitles,
                        title: targetTitle,
                        season: targetSeason,
                        episode: targetEpisode,
                        imdbId: episodeContext.imdbId
                    }
                });
                if (process.env.NODE_ENV === "development") {
                    console.log("Preloaded next episode:", targetTitle);
                }
            }

        } catch (e) {
            console.error("Preload failed", e);
        }
    },

    playNextEpisode: async (addons, options) => {
        const { episodeContext, play, preloadedData, playSource } = get();
        if (!episodeContext) {
            toast.error("No episode context", { description: "Cannot navigate to next episode", position: TOAST_POSITION });
            return;
        }

        const nextEpisode = episodeContext.episode + 1;
        let targetSeason = episodeContext.season;
        let targetEpisode = nextEpisode;

        // Check preload
        if (preloadedData && preloadedData.imdbId === episodeContext.imdbId) {
            const isDirectNext = (preloadedData.season === episodeContext.season && preloadedData.episode === nextEpisode);
            const isNextSeasonStart = (preloadedData.season === episodeContext.season + 1 && preloadedData.episode === 1);

            if (isDirectNext || isNextSeasonStart) {
                // USE PRELOADED
                const progressKey = {
                    imdbId: episodeContext.imdbId,
                    type: "show" as const,
                    season: preloadedData.season,
                    episode: preloadedData.episode,
                };

                set({
                    episodeContext: {
                        ...episodeContext,
                        season: preloadedData.season,
                        episode: preloadedData.episode,
                        title: cleanShowTitle(preloadedData.title),
                    },
                    preloadedData: null
                });

                playSource(preloadedData.source, preloadedData.title, {
                    subtitles: preloadedData.subtitles,
                    progressKey
                });

                toast.success("Playing next episode", { description: preloadedData.title, position: TOAST_POSITION });
                return;
            }
        }

        // Fallback to standard fetch
        try {
            const { traktClient } = await import("@/lib/trakt");
            const episodes = await traktClient.getShowEpisodes(episodeContext.imdbId, targetSeason);
            const currentSeasonEpCount = episodes.length;

            if (nextEpisode > currentSeasonEpCount) {
                targetSeason += 1;
                targetEpisode = 1;

                try {
                    const nextSeasonEpisodes = await traktClient.getShowEpisodes(episodeContext.imdbId, targetSeason);
                    if (nextSeasonEpisodes.length === 0) throw new Error("No episodes");

                    const epData = nextSeasonEpisodes.find(e => e.number === 1);
                    const titleSuffix = epData?.title ? ` - ${epData.title}` : "";
                    const nextTitle = `${episodeContext.title} S${String(targetSeason).padStart(2, "0")}E01${titleSuffix}`;

                    await play({
                        imdbId: episodeContext.imdbId,
                        type: "show",
                        title: nextTitle,
                        tvParams: { season: targetSeason, episode: 1 }
                    }, addons, options);
                    return;

                } catch {
                    toast.info("End of series", { description: "You've reached the last episode", position: TOAST_POSITION });
                    return;
                }
            } else {
                const epData = episodes.find(e => e.number === nextEpisode);
                const titleSuffix = epData?.title ? ` - ${epData.title}` : "";
                const nextTitle = `${episodeContext.title} S${String(targetSeason).padStart(2, "0")}E${String(targetEpisode).padStart(2, "0")}${titleSuffix}`;

                await play({
                    imdbId: episodeContext.imdbId,
                    type: "show",
                    title: nextTitle,
                    tvParams: { season: targetSeason, episode: targetEpisode }
                }, addons, options);
            }
        } catch (error) {
            console.error("Failed to navigate/fetch metadata:", error);
            await play({
                imdbId: episodeContext.imdbId,
                type: "show",
                title: episodeContext.title,
                tvParams: { season: targetSeason, episode: targetEpisode }
            }, addons, options);
        }
    },

    playPreviousEpisode: async (addons, options) => {
        const { episodeContext, play } = get();
        if (!episodeContext) {
            toast.error("No episode context", { description: "Cannot navigate to previous episode", position: TOAST_POSITION });
            return;
        }

        const prevEpisode = episodeContext.episode - 1;

        if (prevEpisode < 1) {
            const prevSeason = episodeContext.season - 1;
            if (prevSeason >= 1) {
                // Fetch the previous season's episode list to find the last episode
                try {
                    const { traktClient } = await import("@/lib/trakt");
                    const prevSeasonEpisodes = await traktClient.getShowEpisodes(episodeContext.imdbId, prevSeason);
                    const lastEpisode = prevSeasonEpisodes.length > 0 ? prevSeasonEpisodes.length : 1;
                    await play(
                        {
                            imdbId: episodeContext.imdbId,
                            type: "show",
                            title: episodeContext.title,
                            tvParams: { season: prevSeason, episode: lastEpisode },
                        },
                        addons,
                        options
                    );
                } catch {
                    // Fallback to episode 1 if metadata fetch fails
                    await play(
                        {
                            imdbId: episodeContext.imdbId,
                            type: "show",
                            title: episodeContext.title,
                            tvParams: { season: prevSeason, episode: 1 },
                        },
                        addons,
                        options
                    );
                }
                return;
            }
            toast.info("Beginning of series", { description: "You're at the first episode", position: TOAST_POSITION });
            return;
        }

        await play(
            {
                imdbId: episodeContext.imdbId,
                type: "show",
                title: episodeContext.title,
                tvParams: { season: episodeContext.season, episode: prevEpisode },
            },
            addons,
            options
        );
    },

    cancel: () => {
        // Increment requestId to invalidate in-flight fetches
        requestId++;
        dismissToast();
        set({ activeRequest: null, selectedSource: null, allFetchedSources: [], pendingPlayContext: null, sourcePickerOpen: false });
    },

    dismiss: () => {
        if (toastId) {
            toast.dismiss(toastId);
            toastId = null;
        }
    },
}));
