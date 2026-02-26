"use client";

import { type TraktMedia } from "@/lib/trakt";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { memo, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { getPosterUrl } from "@/lib/utils/media";
import { Star, CircleCheck } from "lucide-react";
import { fetchPosterFromAPIs } from "@/lib/utils/poster-fallback";

/** Construct RPDB poster URL (free public key). Returns null if no IMDB ID. */
function rpdbPosterUrl(imdbId?: string): string | null {
    if (!imdbId?.startsWith("tt")) return null;
    return `https://api.ratingposterdb.com/t0-free-rpdb/imdb/poster-default/${imdbId}.jpg`;
}

/** Construct Metahub poster URL (TMDB-backed CDN). Returns null if no IMDB ID. */
function metahubPosterUrl(imdbId?: string): string | null {
    if (!imdbId?.startsWith("tt")) return null;
    return `https://images.metahub.space/poster/medium/${imdbId}/img`;
}

interface MediaCardProps {
    media: TraktMedia;
    type: "movie" | "show";
    rank?: number;
    watchers?: number;
    watched?: boolean;
    className?: string;
}

export const MediaCard = memo(function MediaCard({ media, type, rank, watched, className }: MediaCardProps) {
    const slug = media.ids?.slug || media.ids?.imdb;
    const linkHref = slug ? `/${type}s/${slug}` : "#";
    const primaryPoster = getPosterUrl(media.images);
    const imdbId = media.ids?.imdb;
    const metahub = metahubPosterUrl(imdbId);
    const rpdb = rpdbPosterUrl(imdbId);

    // Build deduped URL fallback chain: primary → metahub → RPDB
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

    const handleImageError = useCallback(() => {
        const nextIdx = urlIndex + 1;
        if (nextIdx < urlChain.length) {
            setUrlIndex(nextIdx);
            setPosterSrc(urlChain[nextIdx]);
        } else {
            // All URL-based sources failed → triggers API-based fallback via useEffect
            setPosterSrc(null);
        }
    }, [urlIndex, urlChain]);

    // API-based fallback: Cinemeta + TMDB (only when all URL sources fail)
    useEffect(() => {
        if (posterSrc !== null || apiCheckedRef.current || !imdbId) return;
        apiCheckedRef.current = true;
        fetchPosterFromAPIs(imdbId, type, urlChain).then((url) => {
            if (url) setPosterSrc(url);
        });
    }, [posterSrc, imdbId, type, urlChain]);

    return (
        <Link href={linkHref} className="block group focus-visible:outline-none" aria-label={media.title} data-tv-focusable tabIndex={0}>
            <div
                className={cn(
                    "relative overflow-hidden transition-transform duration-300 ease-out hover:scale-hover [content-visibility:auto] [contain-intrinsic-size:120px_180px] rounded-sm group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background",
                    className
                )}>
                <div className="aspect-2/3 relative overflow-hidden bg-muted/50 rounded-sm">
                    {posterSrc ? (
                        <Image
                            src={posterSrc}
                            alt={media.title}
                            fill
                            sizes="(max-width: 640px) 120px, (max-width: 768px) 150px, (max-width: 1280px) 180px, (max-width: 1536px) 190px, 200px"
                            className="object-cover transition-opacity duration-300"
                            loading="lazy"
                            unoptimized
                            onError={handleImageError}
                        />
                    ) : (
                        <div className="absolute inset-0 bg-gradient-to-b from-muted/80 to-muted flex items-center justify-center p-3">
                            <span className="text-sm font-light text-muted-foreground text-center line-clamp-3 leading-snug">
                                {media.title}
                            </span>
                        </div>
                    )}

                    {/* Rank badge - editorial style */}
                    {rank && (
                        <div className="absolute top-2 left-2 z-10">
                            <span className="text-xs font-medium tracking-wider text-white/90 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-sm">
                                {String(rank).padStart(2, "0")}
                            </span>
                        </div>
                    )}

                    {/* Watched badge */}
                    {watched && (
                        <div className="absolute top-2 right-2 z-10">
                            <span className="flex items-center justify-center bg-black/60 backdrop-blur-sm p-1 rounded-sm">
                                <CircleCheck className="size-3.5 text-green-400" />
                            </span>
                        </div>
                    )}

                    {/* Gradient overlay — always visible on touch, hover on desktop */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Content — always visible on touch, hover on desktop */}
                    <div className="absolute inset-x-0 bottom-0 p-3 translate-y-0 opacity-100 sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 transition-all duration-300">
                        <h3 className="font-light text-sm text-white leading-tight line-clamp-2 mb-1.5">
                            {media.title}
                        </h3>

                        <div className="flex items-center gap-2 text-xs text-white/70">
                            {media.year && <span>{media.year}</span>}
                            {media.rating && (
                                <>
                                    <span className="text-white/30">·</span>
                                    <span className="flex items-center gap-1">
                                        <Star className="size-3 fill-primary text-primary -mt-0.5" />
                                        {media.rating.toFixed(1)}
                                    </span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Link>
    );
});
