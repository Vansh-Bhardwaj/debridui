"use client";

import { MediaCard } from "@/components/mdb/media-card";
import { type TraktMediaItem } from "@/lib/trakt";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRightIcon, AlertCircle, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";
import { useWatchedIds } from "@/hooks/use-progress";

interface MediaSectionProps {
    title: string;
    items?: TraktMediaItem[];
    isLoading?: boolean;
    error?: Error | null;
    showRank?: boolean;
    viewAllHref?: string;
    className?: string;
    /** Number of grid rows (default 2). Use 1 for compact catalog rows. */
    rows?: 1 | 2;
    /** Show a "Show more" button when items exceed 20 */
    expandable?: boolean;
    /** Called to retry a failed fetch */
    onRetry?: () => void;
}

const MediaSectionSkeleton = memo(function MediaSectionSkeleton() {
    return (
        <div className="grid grid-rows-2 grid-flow-col auto-cols-[120px] sm:auto-cols-[140px] md:auto-cols-[160px] xl:auto-cols-[175px] 2xl:auto-cols-[190px] gap-3 pt-2 pb-4 max-lg:px-4 w-max">
            {Array.from({ length: 20 }, (_, i) => (
                <div key={i} className="animate-pulse" style={{ animationDelay: `${i * 50}ms` }}>
                    <Skeleton className="aspect-2/3 rounded-sm" />
                </div>
            ))}
        </div>
    );
});

export const MediaSection = memo(function MediaSection({
    title,
    items,
    isLoading,
    error,
    showRank = false,
    viewAllHref,
    className,
    rows = 2,
    expandable = false,
    onRetry,
}: MediaSectionProps) {
    const [page, setPage] = useState(0);
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const watchedIds = useWatchedIds();
    const effectiveRows = tvMode ? 1 : rows;
    const PAGE_SIZE = 20;
    const allItems = useMemo(() => items?.filter((item) => item.movie || item.show) ?? [], [items]);
    const totalPages = expandable ? Math.ceil(allItems.length / PAGE_SIZE) : 1;
    const pageItems = useMemo(
        () => expandable ? allItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : allItems.slice(0, PAGE_SIZE),
        [allItems, expandable, page]
    );
    const itemCount = allItems.length;
    const gridRows = effectiveRows === 1 ? "grid-rows-1" : "grid-rows-2";

    // TV mode: larger card columns for 10-foot viewing
    const gridCols = tvMode
        ? "auto-cols-[180px] sm:auto-cols-[200px] md:auto-cols-[220px] xl:auto-cols-[240px] 2xl:auto-cols-[260px]"
        : "auto-cols-[120px] sm:auto-cols-[140px] md:auto-cols-[160px] xl:auto-cols-[175px] 2xl:auto-cols-[190px]";

    if (error) {
        return (
            <section className={cn("space-y-4", className)}>
                <div className="flex items-end justify-between gap-4">
                    <h2 className="text-sm tracking-widest uppercase text-muted-foreground">{title}</h2>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground py-8">
                    <AlertCircle className="size-4" />
                    <span>Failed to load content</span>
                    {onRetry && (
                        <button
                            onClick={onRetry}
                            className="text-xs text-primary hover:text-primary/80 transition-colors underline underline-offset-2"
                        >
                            Retry
                        </button>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className={cn("space-y-4", className)} data-tv-section>
            {/* Section Header */}
            <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-2 text-sm tracking-widest uppercase text-muted-foreground">
                    <h2>{title}</h2>
                    {!isLoading && itemCount > 0 && <span className="text-border">·</span>}
                    {!isLoading && itemCount > 0 && <span>{itemCount}</span>}
                </div>
                <div className="flex items-center gap-2">
                    {expandable && totalPages > 1 && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={() => setPage((p) => p - 1)}
                                disabled={page === 0}
                                className="flex items-center justify-center size-6 rounded-sm border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 disabled:pointer-events-none transition-colors">
                                <ChevronLeftIcon className="size-3.5" />
                            </button>
                            <span className="text-xs tabular-nums text-muted-foreground/60 min-w-[3rem] text-center">
                                {page + 1} / {totalPages}
                            </span>
                            <button
                                onClick={() => setPage((p) => p + 1)}
                                disabled={page >= totalPages - 1}
                                className="flex items-center justify-center size-6 rounded-sm border border-border/50 text-muted-foreground hover:text-foreground hover:border-border disabled:opacity-30 disabled:pointer-events-none transition-colors">
                                <ChevronRightIcon className="size-3.5" />
                            </button>
                        </div>
                    )}
                    {viewAllHref && (
                        <Link
                            href={viewAllHref}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
                            <span>View all</span>
                            <ArrowRightIcon className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                        </Link>
                    )}
                </div>
            </div>

            {/* Content Grid */}
            <ScrollCarousel className="-mx-4 lg:mx-0">
                {isLoading ? (
                    <MediaSectionSkeleton />
                ) : (
                    <div className={cn("grid grid-flow-col gap-3 pt-2 pb-4 max-lg:px-4 w-max", gridCols, gridRows)}>
                        {pageItems.map((item, index) => {
                            const media = item.movie || item.show;
                            const type = item.movie ? "movie" : "show";
                            return (
                                <div
                                    key={`${type}-${media!.ids?.trakt || index}`}
                                    className="animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                                    style={{ animationDelay: `${Math.min(index * 30, 300)}ms`, animationDuration: "400ms", animationFillMode: "backwards" }}>
                                    <MediaCard
                                        media={media!}
                                        type={type}
                                        rank={showRank ? page * PAGE_SIZE + index + 1 : undefined}
                                        watchers={item.watchers}
                                        watched={!!media!.ids?.imdb && watchedIds.has(media!.ids.imdb)}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </ScrollCarousel>
        </section>
    );
});
