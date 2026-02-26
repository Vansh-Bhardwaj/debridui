"use client";

import { memo } from "react";
import { useTraktRelated } from "@/hooks/use-trakt";
import { MediaCard } from "@/components/mdb/media-card";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsStore } from "@/lib/stores/settings";
import { useWatchedIds } from "@/hooks/use-progress";

interface RelatedMediaProps {
    mediaId: string;
    type: "movie" | "show";
}

export const RelatedMedia = memo(function RelatedMedia({ mediaId, type }: RelatedMediaProps) {
    const { data, isLoading } = useTraktRelated(mediaId, type);
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const watchedIds = useWatchedIds();

    if (!isLoading && (!data || data.length === 0)) return null;

    const gridCols = tvMode
        ? "auto-cols-[180px] sm:auto-cols-[200px] md:auto-cols-[220px] xl:auto-cols-[240px] 2xl:auto-cols-[260px]"
        : "auto-cols-[120px] sm:auto-cols-[140px] md:auto-cols-[160px]";

    return (
        <ScrollCarousel className="-mx-4 lg:mx-0">
            {isLoading ? (
                <div className={`grid grid-rows-1 grid-flow-col ${gridCols} gap-3 pt-2 pb-4 max-lg:px-4 w-max`}>
                    {Array.from({ length: 10 }, (_, i) => (
                        <Skeleton key={i} className="aspect-2/3 rounded-sm animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
                    ))}
                </div>
            ) : (
                <div className={`grid grid-rows-1 grid-flow-col ${gridCols} gap-3 pt-2 pb-4 max-lg:px-4 w-max`}>
                    {data!.map((media, i) => (
                        <div
                            key={media.ids?.trakt ?? media.ids?.imdb ?? media.ids?.slug ?? media.title ?? i}
                            className="animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                            style={{
                                animationDelay: `${Math.min(i * 30, 300)}ms`,
                                animationDuration: "400ms",
                                animationFillMode: "backwards",
                            }}>
                            <MediaCard media={media} type={type} watched={!!media.ids?.imdb && watchedIds.has(media.ids.imdb)} />
                        </div>
                    ))}
                </div>
            )}
        </ScrollCarousel>
    );
});
