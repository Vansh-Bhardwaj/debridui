"use client";

import Image from "next/image";
import { type TraktEpisode } from "@/lib/trakt";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Play, Star } from "lucide-react";
import { cn, formatLocalizedDate } from "@/lib/utils";
import { memo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WatchButton } from "@/components/common/watch-button";
import { Sources } from "./sources";

interface ThumbnailContentProps {
    screenshotUrl: string;
    title?: string;
    episodeLabel: string;
    rating?: number;
    interactive?: boolean;
}

const ThumbnailContent = memo(function ThumbnailContent({
    screenshotUrl,
    title,
    episodeLabel,
    rating,
    interactive,
}: ThumbnailContentProps) {
    return (
        <>
            <Image
                fill
                src={screenshotUrl}
                alt={title || ""}
                sizes="(max-width: 640px) 144px, (max-width: 768px) 224px, 240px"
                unoptimized
                className={cn(
                    "object-cover",
                    interactive && "transition-transform duration-300 group-hover/thumb:scale-hover"
                )}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
            <span className="absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 text-xs font-medium tracking-wider text-white/90 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-sm">
                E{episodeLabel}
            </span>
            {rating && (
                <span className="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 hidden sm:inline-flex items-center gap-1 text-xs font-medium text-white/90 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-sm">
                    <Star className="size-3 fill-primary text-primary" />
                    {rating.toFixed(1)}
                </span>
            )}
            {interactive && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity duration-300">
                    <span className="flex items-center gap-1.5 text-xs tracking-wider uppercase text-white bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-sm">
                        <Play className="size-3 fill-current" />
                        Watch
                    </span>
                </div>
            )}
        </>
    );
});

interface EpisodeCardProps {
    episode: TraktEpisode;
    className?: string;
    imdbId?: string;
    showTitle?: string;
    isWatched?: boolean;
    isNew?: boolean;
    onToggleWatched?: () => void;
    isTogglingWatched?: boolean;
}

export const EpisodeCard = memo(function EpisodeCard({ episode, className, imdbId, showTitle, isWatched, isNew, onToggleWatched, isTogglingWatched }: EpisodeCardProps) {
    const [isOpen, setIsOpen] = useState(false);

    const episodeLabel = String(episode.number).padStart(2, "0");
    const screenshotUrl = episode.images?.screenshot?.[0]
        ? `https://${episode.images.screenshot[0]}`
        : `https://placehold.co/400x225/1a1a1a/3e3e3e?text=${episodeLabel}`;

    const mediaTitle =
        showTitle && episode.season
            ? `${showTitle} S${episode.season.toString().padStart(2, "0")} E${episode.number.toString().padStart(2, "0")}${episode.title ? ` - ${episode.title}` : ""}`
            : episode.title || `Episode ${episode.number}`;

    const tvParams = episode.season ? { season: episode.season, episode: episode.number } : undefined;

    const thumbnailClass =
        "relative w-36 sm:w-56 md:w-60 shrink-0 aspect-[5/3] sm:aspect-video bg-muted/30 overflow-hidden";

    return (
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className={cn("group", className)}>
            <div className={cn(
                "rounded-sm border border-border/50 overflow-hidden transition-colors duration-300",
                isWatched && "border-border/30 opacity-75 hover:opacity-100"
            )}>
                <div className="flex flex-row items-start">
                    {/* Episode thumbnail - clickable to watch */}
                    {imdbId ? (
                        <WatchButton imdbId={imdbId} mediaType="show" title={mediaTitle} tvParams={tvParams}>
                            <button className={cn(thumbnailClass, "cursor-pointer group/thumb")}>
                                <ThumbnailContent
                                    screenshotUrl={screenshotUrl}
                                    title={episode.title}
                                    episodeLabel={episodeLabel}
                                    rating={episode.rating}
                                    interactive
                                />
                                {/* Watched/New overlay badges */}
                                {isWatched && (
                                    <span className="absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 inline-flex items-center gap-1 text-[10px] font-medium tracking-wider text-primary bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
                                        <Check className="size-2.5" />
                                        Watched
                                    </span>
                                )}
                                {isNew && !isWatched && (
                                    <span className="absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 text-[10px] font-medium tracking-wider text-primary bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
                                        NEW
                                    </span>
                                )}
                            </button>
                        </WatchButton>
                    ) : (
                        <div className={thumbnailClass}>
                            <ThumbnailContent
                                screenshotUrl={screenshotUrl}
                                title={episode.title}
                                episodeLabel={episodeLabel}
                                rating={episode.rating}
                            />
                            {isWatched && (
                                <span className="absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 inline-flex items-center gap-1 text-[10px] font-medium tracking-wider text-primary bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
                                    <Check className="size-2.5" />
                                    Watched
                                </span>
                            )}
                            {isNew && !isWatched && (
                                <span className="absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 text-[10px] font-medium tracking-wider text-primary bg-black/60 backdrop-blur-sm px-1.5 py-0.5 rounded-sm">
                                    NEW
                                </span>
                            )}
                        </div>
                    )}

                    {/* Episode details - clickable to toggle sources */}
                    <div className="flex-1 min-w-0">
                        <CollapsibleTrigger asChild>
                            <button className="w-full px-2.5 py-1.5 sm:p-3 md:p-4 text-left cursor-pointer">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                        <h4 className="text-sm sm:text-base font-light line-clamp-1 group-hover:text-foreground/80 transition-colors">
                                            {episode.title || `Episode ${episode.number}`}
                                        </h4>
                                        <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-muted-foreground">
                                            {episode.first_aired && <span>{formatLocalizedDate(episode.first_aired)}</span>}
                                            {episode.first_aired && episode.runtime && (
                                                <span className="text-border">·</span>
                                            )}
                                            {episode.runtime && <span>{episode.runtime}m</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <ChevronDown
                                            className={cn(
                                                "size-4 text-muted-foreground transition-transform duration-300",
                                                isOpen && "rotate-180"
                                            )}
                                        />
                                    </div>
                                </div>
                                {episode.overview && (
                                    <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 leading-relaxed mt-1 sm:mt-1.5 md:mt-2">
                                        {episode.overview}
                                    </p>
                                )}
                            </button>
                        </CollapsibleTrigger>

                        {/* Watched toggle — outside collapsible trigger */}
                        {onToggleWatched && (
                            <div className="px-2.5 pb-1.5 sm:px-3 sm:pb-2 md:px-4 md:pb-3 -mt-1">
                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleWatched(); }}
                                    disabled={isTogglingWatched}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 text-xs rounded-sm px-2 py-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                        isWatched
                                            ? "text-primary hover:text-destructive hover:bg-destructive/10"
                                            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                                    )}
                                    aria-label={isWatched ? "Mark as unwatched" : "Mark as watched"}>
                                    {isTogglingWatched ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : isWatched ? (
                                        <EyeOff className="size-3" />
                                    ) : (
                                        <Eye className="size-3" />
                                    )}
                                    {isWatched ? "Unmark watched" : "Mark watched"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <CollapsibleContent>
                    {isOpen && imdbId && (
                        <div className="bg-muted/20">
                            <Sources
                                imdbId={imdbId}
                                mediaType="show"
                                tvParams={tvParams}
                                mediaTitle={mediaTitle}
                                className="border-x-0 border-b-0 rounded-none"
                            />
                        </div>
                    )}
                </CollapsibleContent>
            </div>
        </Collapsible>
    );
});
