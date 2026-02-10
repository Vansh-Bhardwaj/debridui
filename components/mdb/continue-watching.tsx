"use client";

import { useContinueWatching, type ProgressKey, type ProgressData } from "@/hooks/use-progress";
import { WatchButton } from "@/components/common/watch-button";
import { Play, X, Star, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { traktClient } from "@/lib/trakt";
import { useStreamingStore } from "@/lib/stores/streaming";
import { useUserAddons } from "@/hooks/use-addons";
import { type Addon, type TvSearchParams } from "@/lib/addons/types";
import Image from "next/image";

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

function ContinueWatchingItem({ item, onRemove }: ContinueWatchingItemProps) {
    const { data: media, isLoading: loading } = useTraktMedia(item.imdbId, item.type);

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
        const enabledAddons = addons
            .filter((a: Addon) => a.enabled)
            .sort((a: Addon, b: Addon) => a.order - b.order)
            .map((a: Addon) => ({ id: a.id, url: a.url, name: a.name }));
        play(
            { imdbId: item.imdbId, type: item.type, title: media.title || "Unknown", tvParams: nextEpisode },
            enabledAddons,
        );
    }, [nextEpisode, play, addons, item.imdbId, item.type, media]);

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
        ? `${title} S${item.season}E${item.episode}`
        : title;

    const posterUrl = getPosterUrl(media?.images) || `https://placehold.co/300x450/1a1a1a/3e3e3e?text=${encodeURIComponent(title)}`;

    return (
        <div className="flex-shrink-0 w-40 sm:w-48 group relative">
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
                            className="object-cover transition-transform duration-500 group-hover:scale-105"
                            unoptimized
                        />
                        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/40 transition-colors" />

                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="h-12 w-12 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center backdrop-blur-sm shadow-xl">
                                <Play className="h-6 w-6 fill-current translate-x-0.5" />
                            </div>
                        </div>

                        {/* Progress bar overlay at bottom */}
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 backdrop-blur-sm">
                            <div
                                className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)] transition-all duration-500"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        {/* Remaining time badge */}
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-sm bg-black/60 backdrop-blur-sm text-[10px] font-medium text-white/90">
                            {formatTime(remainingTime)} left
                        </div>
                    </div>

                    <div className="mt-2 text-left">
                        <p className="text-xs font-medium truncate group-hover:text-primary transition-colors pr-6">
                            {displayTitle}
                        </p>
                        {media?.rating && (
                            <div className="flex items-center gap-1 mt-0.5">
                                <Star className="size-2.5 fill-[#F5C518] text-[#F5C518]" />
                                <span className="text-[10px] text-muted-foreground">{media.rating.toFixed(1)}</span>
                            </div>
                        )}
                    </div>
                </button>
            </WatchButton>

            {/* Remove button */}
            <button
                type="button"
                onClick={handleRemove}
                className="absolute top-1 right-1 p-1.5 rounded-sm bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive hover:text-white z-20"
                aria-label="Remove from continue watching"
            >
                <X className="h-3.5 w-3.5" />
            </button>

            {/* Next episode button */}
            {nextEpisode && (
                <button
                    type="button"
                    onClick={handlePlayNext}
                    className="absolute top-1 left-1 p-1.5 rounded-sm bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-all hover:bg-primary hover:text-primary-foreground z-20"
                    aria-label={`Play S${String(nextEpisode.season).padStart(2, "0")}E${String(nextEpisode.episode).padStart(2, "0")}`}
                >
                    <SkipForward className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
}

export function ContinueWatching() {
    const { progress, loading } = useContinueWatching();
    const [items, setItems] = useState<Array<ProgressKey & ProgressData>>([]);

    useEffect(() => {
        setItems(progress);
    }, [progress]);

    const handleRemove = useCallback((key: ProgressKey) => {
        // Remove from local state immediately
        setItems((prev) => prev.filter((item) =>
            !(item.imdbId === key.imdbId &&
                item.season === key.season &&
                item.episode === key.episode)
        ));

        // Remove from localStorage
        const storageKey = key.type === "show" && key.season !== undefined && key.episode !== undefined
            ? `progress:${key.imdbId}:s${key.season}e${key.episode}`
            : `progress:${key.imdbId}`;
        try {
            localStorage.removeItem(storageKey);
        } catch { }

        // Remove from server
        const params = new URLSearchParams({ imdbId: key.imdbId });
        if (key.season !== undefined) params.set("season", String(key.season));
        if (key.episode !== undefined) params.set("episode", String(key.episode));
        fetch(`/api/progress?${params}`, { method: "DELETE" }).catch(() => { });
    }, []);

    if (loading) {
        return (
            <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">Continue Watching</h2>
                <div className="flex gap-4 overflow-x-auto pb-2">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex-shrink-0 w-48 md:w-56">
                            <Skeleton className="aspect-video rounded-lg" />
                            <Skeleton className="h-4 mt-2 w-3/4" />
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    if (items.length === 0) {
        return null; // Don't show section if no items
    }

    return (
        <section className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Continue Watching</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
                {items.map((item) => (
                    <ContinueWatchingItem
                        key={`${item.imdbId}-${item.season}-${item.episode}`}
                        item={item}
                        onRemove={handleRemove}
                    />
                ))}
            </div>
        </section>
    );
}
