"use client";

import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProfile } from "@/hooks/use-profile";
import { useSettingsStore } from "@/lib/stores/settings";
import { traktClient, type TraktMedia } from "@/lib/trakt";
import { recommendations } from "./home-data";
import { MediaCard } from "@/components/mdb/media-card";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { Skeleton } from "@/components/ui/skeleton";
import { useWatchedIds } from "@/hooks/use-progress";
import { useIsTVMode } from "@/hooks/use-tv-mode";

interface RelatedMediaProps {
    mediaId: string;
    type: "movie" | "show";
    media: TraktMedia;
}

export const RelatedMedia = memo(function RelatedMedia({ mediaId, type, media }: RelatedMediaProps) {
    const { activeProfile } = useProfile();
    const key = useSettingsStore((s) => s.get("tmdbApiKey"));
    const { data, isLoading } = useQuery({
        queryKey: ["detail-related", activeProfile.id, type, mediaId, key],
        queryFn: async () => key ? (await recommendations(media, type, key)).flatMap((r) => r.movie ? [r.movie] : r.show ? [r.show] : []) : type === "movie" ? traktClient.getRelatedMovies(mediaId) : traktClient.getRelatedShows(mediaId),
        staleTime: 3600000,
        refetchOnWindowFocus: false,
    });
    const tvMode = useIsTVMode();
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
