"use client";
export const dynamic = "force-static";

import { memo, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Heart, Film, Tv } from "lucide-react";
import { MediaCard } from "@/components/mdb/media-card";
import { EmptyState, LoadingState } from "@/components/common/async-state";
import { useWatchedIds } from "@/hooks/use-progress";
import { traktClient, type TraktMediaItem } from "@/lib/trakt";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";

const INITIAL_LIMIT = 20;
const LOAD_MORE_LIMIT = 10;
const CACHE_DURATION_STANDARD = 15 * 60 * 1000;

function useRecommendationsByType(type: "movies" | "shows", limit: number) {
    return useQuery({
        queryKey: ["trakt", "recommendations", type, limit],
        queryFn: () => traktClient.getRecommendations(type, limit),
        enabled: !!traktClient.getAccessToken(),
        staleTime: CACHE_DURATION_STANDARD,
        gcTime: CACHE_DURATION_STANDARD * 2,
        placeholderData: keepPreviousData,
    });
}

function MediaGrid({
    items,
    type,
    watchedIds,
}: {
    items: TraktMediaItem[];
    type: "movie" | "show";
    watchedIds: Set<string>;
}) {
    return (
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {items.map((item, index) => {
                const media = item.movie || item.show;
                if (!media) return null;
                return (
                    <div
                        key={`${type}-${media.ids?.slug || index}`}
                        className="animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                        style={{
                            animationDelay: `${Math.min(index * 20, 400)}ms`,
                            animationDuration: "400ms",
                            animationFillMode: "backwards",
                        }}
                    >
                        <MediaCard
                            media={media}
                            type={type}
                            watched={!!media.ids?.imdb && watchedIds.has(media.ids.imdb)}
                        />
                    </div>
                );
            })}
        </div>
    );
}

const ForYouPage = memo(function ForYouPage() {
    const [movieLimit, setMovieLimit] = useState(INITIAL_LIMIT);
    const [showLimit, setShowLimit] = useState(INITIAL_LIMIT);

    const { data: movies, isLoading: moviesLoading, isFetching: moviesFetching } = useRecommendationsByType("movies", movieLimit);
    const { data: shows, isLoading: showsLoading, isFetching: showsFetching } = useRecommendationsByType("shows", showLimit);
    const watchedIds = useWatchedIds();

    const movieItems = useMemo(() => movies ?? [], [movies]);
    const showItems = useMemo(() => shows ?? [], [shows]);
    const hasMoreMovies = movieItems.length >= movieLimit;
    const hasMoreShows = showItems.length >= showLimit;

    const loadMoreMovies = useCallback(() => setMovieLimit((prev) => prev + LOAD_MORE_LIMIT), []);
    const loadMoreShows = useCallback(() => setShowLimit((prev) => prev + LOAD_MORE_LIMIT), []);

    const isLoading = moviesLoading && showsLoading && movieItems.length === 0 && showItems.length === 0;
    const isEmpty = !moviesLoading && !showsLoading && movieItems.length === 0 && showItems.length === 0;

    return (
        <div className="space-y-8 py-6 lg:px-6">
            <div className="space-y-3">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                    <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                    <span>Back to Discover</span>
                </Link>

                <div className="flex items-center gap-3">
                    <Heart className="size-5 text-muted-foreground" />
                    <div>
                        <h1 className="text-2xl font-light tracking-tight">For You</h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Personalized recommendations based on your Trakt watch history
                        </p>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <LoadingState label="Loading recommendations..." className="py-24" />
            ) : isEmpty ? (
                <EmptyState
                    title="No recommendations yet"
                    description="Watch more content and connect Trakt to get personalized picks."
                    className="py-14"
                />
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1px_1fr] gap-8 lg:gap-6">
                    {/* Movies column */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Film className="size-4 text-primary" />
                            <h2 className="text-sm tracking-widest uppercase text-muted-foreground">
                                Movies
                                {movieItems.length > 0 && <span className="ml-1.5 text-muted-foreground/50">{movieItems.length}</span>}
                            </h2>
                        </div>
                        {moviesLoading && movieItems.length === 0 ? (
                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {Array.from({ length: 8 }, (_, i) => (
                                    <div key={i} className="aspect-2/3 bg-muted/30 rounded-sm animate-pulse" />
                                ))}
                            </div>
                        ) : (
                            <MediaGrid items={movieItems} type="movie" watchedIds={watchedIds} />
                        )}
                        {hasMoreMovies && (
                            <div className="flex justify-center pt-2">
                                <Button variant="outline" size="sm" onClick={loadMoreMovies} disabled={moviesFetching}>
                                    {moviesFetching ? "Loading..." : "Load more movies"}
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Vertical divider — only visible on lg+ */}
                    <div className="hidden lg:block bg-border/50" />
                    {/* Horizontal divider — only visible below lg */}
                    <div className="lg:hidden h-px bg-border/50" />

                    {/* Shows column */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Tv className="size-4 text-primary" />
                            <h2 className="text-sm tracking-widest uppercase text-muted-foreground">
                                TV Shows
                                {showItems.length > 0 && <span className="ml-1.5 text-muted-foreground/50">{showItems.length}</span>}
                            </h2>
                        </div>
                        {showsLoading && showItems.length === 0 ? (
                            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                                {Array.from({ length: 8 }, (_, i) => (
                                    <div key={i} className="aspect-2/3 bg-muted/30 rounded-sm animate-pulse" />
                                ))}
                            </div>
                        ) : (
                            <MediaGrid items={showItems} type="show" watchedIds={watchedIds} />
                        )}
                        {hasMoreShows && (
                            <div className="flex justify-center pt-2">
                                <Button variant="outline" size="sm" onClick={loadMoreShows} disabled={showsFetching}>
                                    {showsFetching ? "Loading..." : "Load more shows"}
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
});

export default function Page() {
    return <ForYouPage />;
}
