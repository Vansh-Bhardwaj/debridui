"use client";

import { memo, useMemo } from "react";
import { useTMDBMovieCollection } from "@/hooks/use-tmdb";
import { useTraktSlugFromTmdb } from "@/hooks/use-trakt";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { SectionDivider } from "@/components/common/section-divider";
import { Skeleton } from "@/components/ui/skeleton";
import { cdnUrl } from "@/lib/utils/media";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";

interface MovieCollectionProps {
    tmdbId: number | undefined;
    /** Current movie's TMDB ID — used to highlight the current entry */
    currentTmdbId: number | undefined;
}

export const MovieCollection = memo(function MovieCollection({ tmdbId, currentTmdbId }: MovieCollectionProps) {
    const apiKey = useSettingsStore((s) => s.get("tmdbApiKey"));
    const { data: collection, isLoading } = useTMDBMovieCollection(tmdbId);

    // Sort parts by release date, unreleased last
    const parts = collection?.parts;
    const sortedParts = useMemo(() => {
        if (!parts) return [];
        return [...parts].sort((a, b) => {
            if (!a.release_date) return 1;
            if (!b.release_date) return -1;
            return a.release_date.localeCompare(b.release_date);
        });
    }, [parts]);

    // Don't render if no TMDB key, or collection has ≤1 movie (just the current one)
    if (!apiKey || (!isLoading && (!collection || sortedParts.length <= 1))) return null;

    return (
        <section className="space-y-6">
            <SectionDivider label={collection?.name || "Collection"} />
            <ScrollCarousel className="-mx-4 lg:mx-0">
            {isLoading ? (
                <div className="grid grid-rows-1 grid-flow-col auto-cols-[120px] sm:auto-cols-[140px] md:auto-cols-[160px] gap-3 pt-2 pb-4 max-lg:px-4 w-max">
                    {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="aspect-2/3 rounded-sm" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-rows-1 grid-flow-col auto-cols-[120px] sm:auto-cols-[140px] md:auto-cols-[160px] gap-3 pt-2 pb-4 max-lg:px-4 w-max">
                    {sortedParts.map((movie, i) => {
                        const isCurrent = movie.id === currentTmdbId;
                        const year = movie.release_date?.slice(0, 4);
                        const posterUrl = movie.poster_path
                            ? cdnUrl(`${TMDB_IMAGE_BASE}${movie.poster_path}`, { w: 300, h: 450 })
                            : `https://placehold.co/300x450/1a1a1a/3e3e3e?text=${encodeURIComponent(movie.title)}`;

                        return (
                            <CollectionCard
                                key={movie.id}
                                tmdbId={movie.id}
                                title={movie.title}
                                year={year}
                                posterUrl={posterUrl}
                                isCurrent={isCurrent}
                                index={i}
                            />
                        );
                    })}
                </div>
            )}
            </ScrollCarousel>
        </section>
    );
});

/** Individual collection movie card — resolves Trakt slug for linking */
const CollectionCard = memo(function CollectionCard({
    tmdbId,
    title,
    year,
    posterUrl,
    isCurrent,
    index,
}: {
    tmdbId: number;
    title: string;
    year: string | undefined;
    posterUrl: string;
    isCurrent: boolean;
    index: number;
}) {
    // Resolve TMDB ID → Trakt slug (cached 24h per movie)
    const { data: slug } = useTraktSlugFromTmdb(isCurrent ? undefined : tmdbId);
    const href = slug ? `/movies/${slug}` : undefined;

    const card = (
        <div
            className={cn(
                "animate-in fade-in-0 slide-in-from-bottom-2",
                isCurrent && "ring-2 ring-primary rounded-sm"
            )}
            style={{
                animationDelay: `${Math.min(index * 30, 300)}ms`,
                animationDuration: "400ms",
                animationFillMode: "backwards",
            }}>
            <div className="group relative overflow-hidden rounded-sm transition-transform duration-300 ease-out hover:scale-hover">
                <Image
                    src={posterUrl}
                    alt={title || ""}
                    width={300}
                    height={450}
                    unoptimized
                    className="aspect-2/3 w-full object-cover"
                    loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-0 inset-x-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className="text-xs font-medium text-white truncate">{title}</p>
                    {year && <p className="text-xs text-white/60">{year}</p>}
                </div>
                {isCurrent && (
                    <div className="absolute top-1.5 right-1.5">
                        <span className="text-[10px] tracking-widest uppercase bg-primary/90 text-primary-foreground px-1.5 py-0.5 rounded-sm font-medium">
                            Current
                        </span>
                    </div>
                )}
            </div>
        </div>
    );

    if (isCurrent || !href) return card;

    return (
        <Link href={href} className="block">
            {card}
        </Link>
    );
});
