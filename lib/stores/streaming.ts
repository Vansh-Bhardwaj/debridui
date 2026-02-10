import { create } from "zustand";
import { type AddonSource, type AddonSubtitle, type TvSearchParams, type AddonManifest, addonSupportsStreams, addonSupportsSubtitles } from "@/lib/addons/types";
import { isEnglishSubtitle, getSubtitleLabel } from "@/lib/utils/subtitles";
import { AddonClient } from "@/lib/addons/client";
import { parseStreams } from "@/lib/addons/parser";
import { selectBestSource } from "@/lib/streaming/source-selector";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import { FileType, MediaPlayer } from "@/lib/types";
import { openInPlayer } from "@/lib/utils/media-player";
import { useSettingsStore } from "./settings";
import { usePreviewStore } from "./preview";
import type { ProgressKey } from "@/hooks/use-progress";

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

    // Preloading
    preloadedData: PreloadedData | null;
    preloadNextEpisode: (addons: { id: string; url: string; name: string }[]) => Promise<void>;

    play: (request: StreamingRequest, addons: { id: string; url: string; name: string }[]) => Promise<void>;
    playSource: (source: AddonSource, title: string, options?: { subtitles?: AddonSubtitle[]; progressKey?: ProgressKey }) => void;
    playNextEpisode: (addons: { id: string; url: string; name: string }[]) => Promise<void>;
    playPreviousEpisode: (addons: { id: string; url: string; name: string }[]) => Promise<void>;
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

// Minimum time toast must be visible before dismissing (allows mount animation)
const MIN_TOAST_DURATION = 300;
const TOAST_POSITION = "bottom-center" as const;

type SubtitleQueryResult = {
    addonName: string;
    subtitles: AddonSubtitle[];
};

function combineEnglishSubtitles(results: SubtitleQueryResult[]): AddonSubtitle[] {
    const byKey = new Map<string, AddonSubtitle>();

    for (const { addonName, subtitles } of results) {
        if (!subtitles) continue;

        for (const sub of subtitles) {
            if (!sub?.url || !sub.lang) continue;
            if (!isEnglishSubtitle(sub)) continue;

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
}

function showSourceToast({ source, title, isCached, autoPlay, allowUncached, onPlay }: ShowSourceToastParams) {
    if (autoPlay && (isCached || allowUncached)) {
        dismissToast();
        onPlay();
        return;
    }

    const meta = [source.resolution, source.quality, source.size].filter(Boolean).join(" · ");
    const cacheStatus = isCached ? "Cached" : "Not cached";
    const description = `${meta} · ${cacheStatus}`.replace(/^ · /, "");

    if (isCached || allowUncached) {
        toast.success(title, {
            id: toastId ?? undefined,
            position: TOAST_POSITION,
            description,
            action: { label: "Play", onClick: onPlay },
            duration: Infinity,
        });
    } else {
        toast.warning(title, {
            id: toastId ?? undefined,
            position: TOAST_POSITION,
            description,
            action: { label: "Play Anyway", onClick: onPlay },
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

    playSource: (source, title, options) => {
        if (!source.url) return;

        const mediaPlayer = useSettingsStore.getState().get("mediaPlayer");

        // Build descriptive filename with source metadata
        const meta = [source.resolution, source.quality, source.size].filter(Boolean).join(" ");
        const fileName = meta ? `${title} [${meta}]` : title;

        if (mediaPlayer === MediaPlayer.BROWSER) {
            usePreviewStore.getState().openSinglePreview({
                url: source.url,
                title: fileName,
                fileType: FileType.VIDEO,
                subtitles: options?.subtitles,
                progressKey: options?.progressKey,
            });
        } else {
            openInPlayer({ url: source.url, fileName, player: mediaPlayer, subtitles: options?.subtitles?.map((s) => s.url), progressKey: options?.progressKey });
        }
    },

    play: async (request, addons) => {
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

            const sourcePromises = streamAddons.map(async (addon) => {
                const queryKey = ["addon", addon.id, "sources", imdbId, type, tvParams] as const;

                const cached = queryClient.getQueryData<AddonSource[]>(queryKey);
                if (cached?.length) return cached;

                try {
                    const client = new AddonClient({ url: addon.url });
                    const response = await client.fetchStreams(imdbId, type, tvParams);
                    const parsed = parseStreams(response.streams, addon.id, addon.name);
                    // Only cache non-empty results so retries can re-fetch
                    if (parsed.length > 0) {
                        queryClient.setQueryData(queryKey, parsed);
                    }
                    return parsed;
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
            const englishSubtitles = combineEnglishSubtitles(subtitleResults);

            const streamingSettings = useSettingsStore.getState().get("streaming");
            const result = selectBestSource(allSources, streamingSettings);

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
                return;
            }

            const { playSource, getProgressKey } = get();
            const source = result.source!;
            const progressKey = getProgressKey();

            set({ activeRequest: null, selectedSource: source });

            showSourceToast({
                source,
                title: displayTitle,
                isCached: result.isCached,
                autoPlay: streamingSettings.autoPlay,
                allowUncached: streamingSettings.allowUncached,
                onPlay: () =>
                    playSource(source, displayTitle, {
                        progressKey: progressKey ?? undefined,
                        subtitles: englishSubtitles.length > 0 ? englishSubtitles : undefined,
                    }),
            });
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
                const cached = queryClient.getQueryData<AddonSource[]>(queryKey);
                if (cached) return cached;
                try {
                    const client = new AddonClient({ url: addon.url });
                    const response = await client.fetchStreams(episodeContext.imdbId, "show", { season: targetSeason, episode: targetEpisode });
                    const parsed = parseStreams(response.streams, addon.id, addon.name);
                    queryClient.setQueryData(queryKey, parsed);
                    return parsed;
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
            const englishSubtitles = combineEnglishSubtitles(subtitleResults);

            const streamingSettings = useSettingsStore.getState().get("streaming");
            const result = selectBestSource(allSources, streamingSettings);

            if (result.source) {
                set({
                    preloadedData: {
                        source: result.source,
                        subtitles: englishSubtitles,
                        title: targetTitle,
                        season: targetSeason,
                        episode: targetEpisode,
                        imdbId: episodeContext.imdbId
                    }
                });
                console.log("Preloaded next episode:", targetTitle);
            }

        } catch (e) {
            console.error("Preload failed", e);
        }
    },

    playNextEpisode: async (addons) => {
        const { episodeContext, play, preloadedData, playSource } = get();
        if (!episodeContext) {
            toast.error("No episode context", { description: "Cannot navigate to next episode" });
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
                    }, addons);
                    return;

                } catch {
                    toast.info("End of series", { description: "You've reached the last episode" });
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
                }, addons);
            }
        } catch (error) {
            console.error("Failed to navigate/fetch metadata:", error);
            await play({
                imdbId: episodeContext.imdbId,
                type: "show",
                title: episodeContext.title,
                tvParams: { season: targetSeason, episode: targetEpisode }
            }, addons);
        }
    },

    playPreviousEpisode: async (addons) => {
        const { episodeContext, play } = get();
        if (!episodeContext) {
            toast.error("No episode context", { description: "Cannot navigate to previous episode" });
            return;
        }

        const prevEpisode = episodeContext.episode - 1;

        if (prevEpisode < 1) {
            const prevSeason = episodeContext.season - 1;
            if (prevSeason >= 1) {
                await play(
                    {
                        imdbId: episodeContext.imdbId,
                        type: "show",
                        title: episodeContext.title,
                        tvParams: { season: prevSeason, episode: 1 }, // Imperfect, assumes 1
                    },
                    addons
                );
                return;
            }
            toast.info("Beginning of series", { description: "You're at the first episode" });
            return;
        }

        await play(
            {
                imdbId: episodeContext.imdbId,
                type: "show",
                title: episodeContext.title,
                tvParams: { season: episodeContext.season, episode: prevEpisode },
            },
            addons
        );
    },

    cancel: () => {
        // Increment requestId to invalidate in-flight fetches
        requestId++;
        dismissToast();
        set({ activeRequest: null, selectedSource: null });
    },

    dismiss: () => {
        if (toastId) {
            toast.dismiss(toastId);
            toastId = null;
        }
    },
}));
