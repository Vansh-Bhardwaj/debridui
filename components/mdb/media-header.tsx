import { type TraktMedia } from "@/lib/trakt";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { MediaStats } from "./media-stats";
import { memo } from "react";
import { getPosterUrl, getBackdropUrl } from "@/lib/utils/media";
import { ArrowUpRight as ArrowUpRightIcon, Star } from "reicon-react";
import { DetailPlayButton } from "./detail-play-button";
import { TrailerButton } from "./trailer-button";
import { MyListButton } from "./my-list-button";
import { MediaActions } from "./media-actions";

interface MediaHeaderProps {
    media: TraktMedia;
    mediaId: string;
    type: "movie" | "show";
}

export const MediaHeader = memo(function MediaHeader({ media, type }: MediaHeaderProps) {
    const posterUrl =
        getPosterUrl(media.images) ||
        `https://placehold.co/300x450/1a1a1a/3e3e3e?text=${encodeURIComponent(media.title)}`;
    const backdropUrl = getBackdropUrl(media.images);

    return (
        <div className="relative">
            <div className="absolute inset-0 left-1/2 -translate-x-1/2 w-screen overflow-hidden -mt-6 bg-muted/30">
                {backdropUrl && <img src={backdropUrl} alt="" className="w-full h-full object-cover opacity-25" loading="eager" decoding="async" />}
            </div>

            {/* Content */}
            <div className="relative pt-[12vh] sm:pt-[20vh] md:pt-[30vh] pb-8">
                <div className="grid md:grid-cols-[180px_1fr] lg:grid-cols-[240px_1fr] xl:grid-cols-[280px_1fr] 2xl:grid-cols-[320px_1fr] gap-6 md:gap-8 animate-in fade-in-0 slide-in-from-bottom-6 duration-700 ease-premium motion-reduce:animate-none motion-reduce:duration-0">
                    {/* Poster Column */}
                    <div className="space-y-4 max-md:mx-auto">
                        <div className="max-md:max-w-[45vw] aspect-2/3 overflow-hidden rounded-sm bg-muted/30">
                            <img
                                src={posterUrl}
                                alt={media.title}
                                className="w-full h-full object-cover"
                                loading="eager"
                                decoding="async"
                            />
                        </div>

                    </div>

                    {/* Info Column */}
                    <div className="space-y-6">
                        {/* Title & Type */}
                        <div className="space-y-3">
                            <div className="text-xs tracking-widest uppercase text-muted-foreground">
                                {type === "movie" ? "Film" : "Series"}
                            </div>
                            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-light leading-tight">{media.title}</h1>
                        </div>

                        {/* Metadata Line */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                            {media.year && <span>{media.year}</span>}
                            {media.rating && (
                                <>
                                    <span className="text-border">·</span>
                                    <span className="flex items-center gap-1.5">
                                        <Star weight="Filled" className="size-4 text-primary" />
                                        <span className="text-foreground font-medium">{media.rating.toFixed(1)}</span>
                                        <span className="text-muted-foreground/60">/10</span>
                                    </span>
                                </>
                            )}
                            {media.runtime && (
                                <>
                                    <span className="text-border">·</span>
                                    <span>{media.runtime}m</span>
                                </>
                            )}
                            {media.certification && (
                                <>
                                    <span className="text-border">·</span>
                                    <Badge>{media.certification}</Badge>
                                </>
                            )}
                            {type === "show" && media.status && (
                                <>
                                    <span className="text-border">·</span>
                                    <span className="capitalize">{media.status.replace(/_/g, " ")}</span>
                                </>
                            )}
                        </div>

                        {/* Genres */}
                        {media.genres && media.genres.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {media.genres.map((genre) => (
                                    <span
                                        key={genre}
                                        className="text-xs text-foreground/80 px-2.5 py-1 bg-muted/50 rounded-sm">
                                        {genre}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Overview */}
                        {media.overview && (
                            <div className="space-y-2">
                                <p className="text-sm sm:text-base text-foreground/80 leading-relaxed max-w-2xl">
                                    {media.overview}
                                </p>
                            </div>
                        )}

                        <div className="flex flex-wrap gap-3 pt-2" data-tv-section>
                            <DetailPlayButton media={media} type={type} />
                            <MyListButton media={media} type={type} />
                            <TrailerButton url={media.trailer} title={media.title} imdbId={media.ids?.imdb} type={type} />
                            <div className="md:hidden"><MediaActions media={media} type={type} hideWatchlist /></div>
                        </div>

                        {/* Stats */}
                        <MediaStats media={media} type={type} />

                        {/* Trakt Actions (inline icons for desktop) */}
                        <div className="hidden md:block">
                            <MediaActions media={media} type={type} hideWatchlist />
                        </div>

                        {/* External Links */}
                        {media.ids && (
                            <div className="flex flex-wrap items-center gap-5 pt-2">
                                {media.homepage && (
                                    <Link
                                        href={media.homepage}
                                        target="_blank"
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <ArrowUpRightIcon className="size-4 opacity-60" />
                                        Website
                                    </Link>
                                )}
                                {!!media.ids?.imdb && (
                                    <Link
                                        href={`https://www.imdb.com/title/${media.ids?.imdb}`}
                                        target="_blank"
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <img
                                            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/imdb.svg"
                                            alt=""
                                            className="size-4 opacity-60 dark:invert"
                                        />
                                        IMDb
                                    </Link>
                                )}
                                {!!media.ids.tmdb && (
                                    <Link
                                        href={`https://www.themoviedb.org/${type}/${media.ids.tmdb}`}
                                        target="_blank"
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <img
                                            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/themoviedatabase.svg"
                                            alt=""
                                            className="size-4 opacity-60 dark:invert"
                                        />
                                        TMDB
                                    </Link>
                                )}
                                {!!media.ids.trakt && (
                                    <Link
                                        href={`https://trakt.tv/${type === "movie" ? "movies" : "shows"}/${media.ids.trakt}`}
                                        target="_blank"
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <img
                                            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/trakt.svg"
                                            alt=""
                                            className="size-4 opacity-60 dark:invert"
                                        />
                                        Trakt
                                    </Link>
                                )}
                                {type === "show" && !!media.ids?.imdb && (
                                    <Link
                                        href={`https://tvcharts.co/show/${media.ids?.imdb}`}
                                        target="_blank"
                                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        <ArrowUpRightIcon className="size-4 opacity-60" />
                                        TV Charts
                                    </Link>
                                )}
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
});
