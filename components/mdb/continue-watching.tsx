"use client";

import { useContinueWatching, type ProgressKey, type ProgressData } from "@/hooks/use-progress";
import { WatchButton } from "@/components/common/watch-button";
import { Play, X, Star, SkipForward } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { traktClient } from "@/lib/trakt";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useUserAddons } from "@/hooks/use-addons";
import { type Addon, type TvSearchParams } from "@/lib/addons/types";
import Image from "next/image";
import Link from "next/link";
import { ScrollCarousel } from "@/components/common/scroll-carousel";

interface ContinueWatchingItemProps {
    item: ProgressKey & ProgressData;
    onRemove: (key: ProgressKey) => void;
}

function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 2) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
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
    const episodeTitle = episodes?.find((e) => e.number === item.episode)?.title;

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

    const nextEpisode = useNextEpisode(item.imdbId, item.type, item.season, item.episode);
    const play = useStreamingStore((s) => s.play);
    const { data: addons = [] } = useUserAddons();

    const handlePlayNext = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!nextEpisode || !media) return;
        // Mark the current episode as done so it no longer appears in continue watching
        // while the new episode is loading. The user explicitly chose to skip forward.
        onRemove(item);
        const enabledAddons = addons
            .filter((a: Addon) => a.enabled)
            .sort((a: Addon, b: Addon) => a.order - b.order)
            .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
        play(
            { imdbId: item.imdbId, type: item.type, title: media.title || "Unknown", tvParams: nextEpisode },
            enabledAddons,
        );
    }, [nextEpisode, play, addons, item, media, onRemove]);

    if (loading) {
        return (
            <div className="flex-shrink-0 w-40 sm:w-48">
                <Skeleton className="aspect-2/3 rounded-sm" />
                <Skeleton className="h-4 mt-2 w-3/4" />
            </div>
        );
    }

    const title = media?.title || "Unknown";
    const displayTitle = item.type === "show" && item.season && item.episode
        ? `S${item.season}E${item.episode}${episodeTitle ? ` · ${episodeTitle}` : ""}`
        : title;

    const relativeTime = formatRelativeTime(item.updatedAt);

    const posterUrl = getPosterUrl(media?.images) || `https://placehold.co/300x450/1a1a1a/3e3e3e?text=${encodeURIComponent(title)}`;

    const mediaSlug = media?.ids?.slug || media?.ids?.imdb;
    const mediaHref = mediaSlug ? `/${item.type === "movie" ? "movies" : "shows"}/${mediaSlug}` : "#";

    return (
        <div className="flex-shrink-0 w-40 sm:w-48 xl:w-52 2xl:w-56 group relative [content-visibility:auto] [contain-intrinsic-size:160px_320px]">
            <WatchButton
                imdbId={item.imdbId}
                mediaType={item.type}
                title={title}
                tvParams={item.type === "show" ? { season: item.season!, episode: item.episode! } : undefined}
            >
                <button
                    type="button"
                    className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm overflow-hidden"
                >
                    {/* Poster with progress overlay */}
                    <div className="relative aspect-2/3 bg-muted rounded-sm overflow-hidden border border-border/50">
                        <Image
                            src={posterUrl}
                            alt={title}
                            fill
                            sizes="(max-width: 640px) 160px, (max-width: 1280px) 192px, (max-width: 1536px) 208px, 224px"
                            className="object-cover transition-transform duration-300 group-hover:scale-hover"
                            unoptimized
                        />
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />

                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <div className="size-12 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center backdrop-blur-sm shadow-xl">
                                <Play className="size-6 fill-current translate-x-0.5" />
                            </div>
                        </div>

                        {/* Progress bar overlay at bottom */}
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 backdrop-blur-sm">
                            <div
                                className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)] transition-all duration-300"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Remaining time badge */}
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-sm text-[10px] font-medium text-white/90">
                            {formatTime(remainingTime)} left
                        </div>
                    </div>
                </button>
            </WatchButton>

            {/* Title + rating — links to media page */}
            <Link href={mediaHref} className="block mt-2">
                <p className="text-xs font-medium truncate hover:text-primary transition-colors pr-6">
                    {title}
                </p>
                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {displayTitle}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                    {media?.rating && (
                        <div className="flex items-center gap-1">
                            <Star className="size-2.5 fill-primary text-primary" />
                            <span className="text-[10px] text-muted-foreground">{media.rating.toFixed(1)}</span>
                        </div>
                    )}
                    <span className="text-[10px] text-muted-foreground/60">{relativeTime}</span>
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

            {/* Next episode button */}
            {nextEpisode && (
                <button
                    type="button"
                    onClick={handlePlayNext}
                    className="absolute top-1 left-1 p-1.5 rounded-sm bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all hover:bg-primary hover:text-primary-foreground z-20"
                    aria-label={`Play S${String(nextEpisode.season).padStart(2, "0")}E${String(nextEpisode.episode).padStart(2, "0")}`}
                >
                    <SkipForward className="size-3.5" />
                </button>
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

    const handleScrollKeyDown = useCallback((e: React.KeyboardEvent) => {
        const viewport = scrollRef.current?.parentElement;
        if (!viewport) return;
        const scrollAmount = 200;
        if (e.key === "ArrowRight") {
            viewport.scrollBy({ left: scrollAmount, behavior: "smooth" });
        } else if (e.key === "ArrowLeft") {
            viewport.scrollBy({ left: -scrollAmount, behavior: "smooth" });
        }
    }, []);

    if (loading) {
        return (
            <section className="mb-8">
                <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Continue Watching</h2>
                <div className="relative mt-4">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
                    <ScrollCarousel className="-mx-4 px-4 lg:mx-0 lg:px-0">
                        <div className="flex snap-x snap-mandatory gap-4 pb-2">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="w-40 flex-shrink-0 snap-start sm:w-48 xl:w-52 2xl:w-56">
                                <Skeleton className="aspect-2/3 rounded-sm" />
                                <Skeleton className="h-4 mt-2 w-3/4" />
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
        <section className="mb-8">
            <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Continue Watching</h2>
            <div className="relative mt-4">
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
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
