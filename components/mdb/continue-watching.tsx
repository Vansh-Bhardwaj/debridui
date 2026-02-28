"use client";

import { useContinueWatching, type ProgressKey, type ProgressData } from "@/hooks/use-progress";
import { WatchButton } from "@/components/common/watch-button";
import { X, SkipForward, Play } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { traktClient } from "@/lib/trakt";
import { type TvSearchParams } from "@/lib/addons/types";
import Image from "next/image";
import Link from "next/link";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { getCachedSource } from "@/lib/utils/source-cache";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useUserAddons } from "@/hooks/use-addons";
import { type Addon } from "@/lib/addons/types";

interface ContinueWatchingItemProps {
    item: ProgressKey & ProgressData;
    onRemove: (key: ProgressKey) => void;
}

/** Fetch season data from Trakt to determine the correct next episode,
 *  handling season transitions and hiding when no more episodes exist. */
function useNextEpisode(
    imdbId: string,
    type: "movie" | "show",
    season?: number,
    episode?: number,
): TvSearchParams | null {
    const { data: seasons } = useQuery({
        queryKey: ["trakt", "show", "seasons", imdbId],
        queryFn: () => traktClient.getShowSeasons(imdbId),
        staleTime: 24 * 60 * 60 * 1000,
        enabled: type === "show" && !!season && !!episode,
    });

    return useMemo(() => {
        if (!seasons || !season || !episode) return null;

        const regularSeasons = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
        const current = regularSeasons.find((s) => s.number === season);
        if (!current) return null;

        // More episodes in the current season
        if (episode < (current.aired_episodes ?? 0)) {
            return { season, episode: episode + 1 };
        }

        // Jump to the next season with aired episodes
        const next = regularSeasons.find((s) => s.number > season && (s.aired_episodes ?? 0) > 0);
        if (next) return { season: next.number, episode: 1 };

        return null;
    }, [seasons, season, episode]);
}

const ContinueWatchingItem = memo(function ContinueWatchingItem({ item, onRemove }: ContinueWatchingItemProps) {
    const { data: media, isLoading: loading } = useTraktMedia(item.imdbId, item.type);

    // For shows: fetch episode data for episode title (24h cache, minimal extra cost)
    const { data: episodes } = useQuery({
        queryKey: ["trakt", "episodes", item.imdbId, item.season],
        queryFn: () => traktClient.getShowEpisodes(item.imdbId, item.season!),
        staleTime: 24 * 60 * 60 * 1000,
        gcTime: 24 * 60 * 60 * 1000,
        enabled: item.type === "show" && !!item.season && !!item.episode,
    });
    const _episodeTitle = episodes?.find((e) => e.number === item.episode)?.title;

    const progressPercent = item.durationSeconds > 0
        ? Math.min(Math.round((item.progressSeconds / item.durationSeconds) * 100), 100)
        : 0;

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    const remainingTime = Math.max(0, item.durationSeconds - item.progressSeconds);

    const handleRemove = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onRemove(item);
    }, [item, onRemove]);

    const { data: addons = [] } = useUserAddons();
    const play = useStreamingStore((s) => s.play);

    const handleResume = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const cached = getCachedSource(item);
        const progressKey = {
            imdbId: item.imdbId,
            type: item.type,
            ...(item.season !== undefined && item.episode !== undefined
                ? { season: item.season, episode: item.episode }
                : {}),
        };

        if (cached) {
            // Instant resume — use cached URL directly
            const addonSource = { url: cached.url, title: cached.title, addonId: "cache", addonName: "Cache" } as import("@/lib/addons/types").AddonSource;
            useStreamingStore.getState().playSource(addonSource, cached.title, { progressKey });
        } else {
            // No cache — fall back to Watch Now flow
            const enabledAddons = addons
                .filter((a: Addon) => a.enabled)
                .sort((a: Addon, b: Addon) => a.order - b.order)
                .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));

            const title = media?.title || "Unknown";
            const tvParams = item.type === "show" && item.season !== undefined && item.episode !== undefined
                ? { season: item.season, episode: item.episode }
                : undefined;

            play(
                { imdbId: item.imdbId, type: item.type, title, tvParams },
                enabledAddons,
                { forceAutoPlay: true },
            );
        }
    }, [item, addons, play, media]);

    const nextEpisode = useNextEpisode(item.imdbId, item.type, item.season, item.episode);
    // Poster fallback chain: primary → metahub → RPDB → API-based → CSS placeholder
    const primaryPoster = getPosterUrl(media?.images);
    const imdbId = item.imdbId;
    const metahub = imdbId.startsWith("tt")
        ? `https://images.metahub.space/poster/medium/${imdbId}/img`
        : null;
    const rpdb = imdbId.startsWith("tt")
        ? `https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/${imdbId}.jpg`
        : null;

    // Build deduped URL fallback chain
    const urlChain = useMemo(() => {
        const urls: string[] = [];
        const seen = new Set<string>();
        for (const url of [primaryPoster, metahub, rpdb]) {
            if (url && !seen.has(url)) {
                seen.add(url);
                urls.push(url);
            }
        }
        return urls;
    }, [primaryPoster, metahub, rpdb]);

    const [urlIndex, setUrlIndex] = useState(0);
    const [posterSrc, setPosterSrc] = useState<string | null>(urlChain[0] ?? null);
    const apiCheckedRef = useRef(false);

    const handlePosterError = useCallback(() => {
        const nextIdx = urlIndex + 1;
        if (nextIdx < urlChain.length) {
            setUrlIndex(nextIdx);
            setPosterSrc(urlChain[nextIdx]);
        } else {
            setPosterSrc(null);
        }
    }, [urlIndex, urlChain]);

    // API-based fallback when all URL sources fail (uses same shared cache as MediaCard)
    useEffect(() => {
        if (posterSrc !== null || apiCheckedRef.current || !imdbId.startsWith("tt")) return;
        apiCheckedRef.current = true;
        import("@/lib/utils/poster-fallback").then(({ fetchPosterFromAPIs }) =>
            fetchPosterFromAPIs(imdbId, item.type, urlChain).then((url) => {
                if (url) setPosterSrc(url);
            })
        );
    }, [posterSrc, imdbId, item.type, urlChain]);

    if (loading) {
        return (
            <div className="flex-shrink-0 w-40 sm:w-48 xl:w-52 2xl:w-56">
                <Skeleton className="aspect-2/3 rounded-sm" />
            </div>
        );
    }

    const title = media?.title || "Unknown";
    const mediaSlug = media?.ids?.slug || media?.ids?.imdb;
    const mediaHref = mediaSlug ? `/${item.type === "movie" ? "movies" : "shows"}/${mediaSlug}` : "#";

    return (
        <div className="flex-shrink-0 w-40 sm:w-48 xl:w-52 2xl:w-56 group relative">
            <Link href={mediaHref} className="block focus-visible:outline-none" aria-label={title} data-tv-focusable tabIndex={0}>
                <div className="relative overflow-hidden rounded-sm transition-transform duration-300 ease-out hover:scale-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                    <div className="aspect-2/3 relative overflow-hidden bg-muted/50 rounded-sm">
                        {posterSrc ? (
                            <Image
                                src={posterSrc}
                                alt={title}
                                fill
                                sizes="(max-width: 640px) 160px, (max-width: 1280px) 192px, (max-width: 1536px) 208px, 224px"
                                className="object-cover transition-opacity duration-300"
                                unoptimized
                                onError={handlePosterError}
                            />
                        ) : (
                            <div className="absolute inset-0 bg-gradient-to-b from-muted/80 to-muted flex items-center justify-center p-3">
                                <span className="text-sm font-light text-muted-foreground text-center line-clamp-3 leading-snug">
                                    {title}
                                </span>
                            </div>
                        )}

                        {/* Progress bar at very bottom */}
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted/60">
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Remaining time badge – bottom left above progress */}
                        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-sm text-[10px] font-medium text-white/90">
                            {formatTime(remainingTime)} left
                        </div>
                    </div>
                </div>
            </Link>

            {/* Remove button */}
            <button
                type="button"
                onClick={handleRemove}
                className="absolute top-1 right-1 p-1.5 rounded-sm bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive hover:text-white z-20"
                aria-label="Remove from continue watching"
            >
                <X className="size-3.5" />
            </button>

            {/* Resume play button — always visible on mobile, hover-only on desktop */}
            <button
                type="button"
                onClick={handleResume}
                className="absolute bottom-3 right-2 z-10 h-9 w-9 rounded-full bg-primary/90 backdrop-blur-sm flex items-center justify-center shadow-lg transition-all sm:opacity-0 sm:group-hover:opacity-100 hover:scale-110 active:scale-95"
                aria-label={`Resume ${title}`}
            >
                <Play className="size-4 fill-current text-primary-foreground ml-0.5" />
            </button>

            {/* Next episode button */}
            {nextEpisode && (
                <WatchButton
                    imdbId={item.imdbId}
                    mediaType={item.type}
                    title={title}
                    tvParams={nextEpisode}
                >
                    <button
                        type="button"
                        className="absolute top-1 left-1 p-1.5 rounded-sm bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all hover:bg-primary hover:text-primary-foreground z-20"
                        aria-label={`Play S${String(nextEpisode.season).padStart(2, "0")}E${String(nextEpisode.episode).padStart(2, "0")}`}
                    >
                        <SkipForward className="size-3.5" />
                    </button>
                </WatchButton>
            )}
        </div>
    );
});

export function ContinueWatching() {
    const { progress, loading } = useContinueWatching();
    const queryClient = useQueryClient();
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

    // Compute items during render — filter out optimistically removed entries
    const items = progress.filter((item) => {
        const id = item.type === "show" && item.season !== undefined && item.episode !== undefined
            ? `${item.imdbId}:s${item.season}e${item.episode}`
            : item.imdbId;
        return !removedIds.has(id);
    });

    const handleRemove = useCallback((key: ProgressKey) => {
        // Optimistic removal from UI immediately
        const id = key.type === "show" && key.season !== undefined && key.episode !== undefined
            ? `${key.imdbId}:s${key.season}e${key.episode}`
            : key.imdbId;
        setRemovedIds((prev) => new Set([...prev, id]));

        // Remove from localStorage
        const storageKey = key.type === "show" && key.season !== undefined && key.episode !== undefined
            ? `progress:${key.imdbId}:s${key.season}e${key.episode}`
            : `progress:${key.imdbId}`;
        try {
            localStorage.removeItem(storageKey);
        } catch { }

        // Remove from server, then invalidate cache so other components reflect the deletion
        const params = new URLSearchParams({ imdbId: key.imdbId, type: key.type });
        if (key.season != null && !isNaN(key.season)) params.set("season", String(key.season));
        if (key.episode != null && !isNaN(key.episode)) params.set("episode", String(key.episode));
        params.set("mode", "hide");
        fetch(`/api/progress?${params}`, { method: "DELETE" })
            .then(() => queryClient.invalidateQueries({ queryKey: ["continue-watching"] }))
            .catch(() => { });
    }, [queryClient]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollingRef = useRef(false);

    const handleScrollKeyDown = useCallback((e: React.KeyboardEvent) => {
        // Prevent jitter from key repeat
        if (scrollingRef.current) return;

        const viewport = scrollRef.current?.parentElement;
        if (!viewport) return;
        const scrollAmount = 200;
        if (e.key === "ArrowRight") {
            scrollingRef.current = true;
            viewport.scrollBy({ left: scrollAmount, behavior: "smooth" });
            setTimeout(() => { scrollingRef.current = false; }, 300);
        } else if (e.key === "ArrowLeft") {
            scrollingRef.current = true;
            viewport.scrollBy({ left: -scrollAmount, behavior: "smooth" });
            setTimeout(() => { scrollingRef.current = false; }, 300);
        }
    }, []);

    if (loading) {
        return (
            <section className="mb-8">
                <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Continue Watching</h2>
                <div className="relative mt-4">

                    <ScrollCarousel className="-mx-4 px-4 lg:mx-0 lg:px-0">
                        <div className="flex snap-x snap-mandatory gap-4 pb-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex-shrink-0 snap-start w-40 sm:w-48 xl:w-52 2xl:w-56">
                                    <Skeleton className="aspect-2/3 rounded-sm" />
                                </div>
                            ))}
                        </div>
                    </ScrollCarousel>
                </div>
            </section>
        );
    }

    if (items.length === 0) {
        return null; // Don't show section if no items
    }

    return (
        <section className="mb-8" data-tv-section>
            <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Continue Watching</h2>
            <div className="relative mt-4">
                <ScrollCarousel className="-mx-4 px-4 lg:mx-0 lg:px-0">
                    <div
                        ref={scrollRef}
                        tabIndex={0}
                        role="region"
                        aria-label="Continue watching"
                        onKeyDown={handleScrollKeyDown}
                        className="flex snap-x snap-mandatory gap-4 pb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                    >
                        {items.map((item) => (
                            <div key={`${item.imdbId}-${item.season}-${item.episode}`} className="snap-start">
                                <ContinueWatchingItem
                                    item={item}
                                    onRemove={handleRemove}
                                />
                            </div>
                        ))}
                    </div>
                </ScrollCarousel>
            </div>
        </section>
    );
}
