"use client";
export const dynamic = "force-static";

import { memo, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Heart, Film, Tv, Sparkles, RotateCcw, Gem } from "lucide-react";
import { MediaCard } from "@/components/mdb/media-card";
import { EmptyState, LoadingState } from "@/components/common/async-state";
import { ScrollCarousel } from "@/components/common/scroll-carousel";
import { useWatchedIds } from "@/hooks/use-progress";
import {
    useTraktRelated,
    useTraktPopularMovies,
    useTraktPopularShows,
    useTraktMedia,
} from "@/hooks/use-trakt";
import { traktClient, type TraktMedia, type TraktMediaItem } from "@/lib/trakt";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { shuffleWithSeed, dailySeed } from "@/lib/utils";

const INITIAL_LIMIT = 20;
const LOAD_MORE_LIMIT = 10;
const CACHE_DURATION_STANDARD = 15 * 60 * 1000;
const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;

interface HistoryEntry {
    id: string;
    imdbId: string;
    type: "movie" | "show";
    season: number | null;
    episode: number | null;
    progressSeconds: number;
    durationSeconds: number;
    watchedAt: string;
}

function useRecommendationsByType(type: "movies" | "shows", limit: number) {
    const seed = dailySeed();
    // Fetch a stable-size larger pool; shuffle + slice to what the caller
    // wanted. Trakt's ranking is deterministic per user, so rotating on the
    // client avoids users seeing identical top-N titles for months.
    const poolSize = Math.max(50, limit * 2);
    return useQuery({
        queryKey: ["trakt", "recommendations", type, poolSize, seed],
        queryFn: async () => {
            const pool = await traktClient.getRecommendations(type, poolSize);
            return shuffleWithSeed(pool, `${seed}-${type}`).slice(0, limit);
        },
        enabled: !!traktClient.getAccessToken(),
        staleTime: CACHE_DURATION_STANDARD,
        gcTime: CACHE_DURATION_STANDARD * 2,
        placeholderData: keepPreviousData,
    });
}

function useHistoryPage() {
    return useQuery<{ history: HistoryEntry[]; total: number }>({
        queryKey: ["watch-history", 100],
        queryFn: async () => {
            const res = await fetch(`/api/history?limit=100&offset=0`);
            if (!res.ok) throw new Error("Failed to fetch history");
            return res.json();
        },
        staleTime: 5 * 60 * 1000,
    });
}

const MediaGrid = memo(function MediaGrid({
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
                const animateEntry = index < 16;
                return (
                    <div
                        key={`${type}-${media.ids?.slug || index}`}
                        className={
                            animateEntry
                                ? "animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                                : undefined
                        }
                        style={
                            animateEntry
                                ? {
                                      animationDelay: `${Math.min(index * 16, 240)}ms`,
                                      animationDuration: "320ms",
                                      animationFillMode: "backwards",
                                  }
                                : undefined
                        }
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
});

/** Horizontal shelf wrapper used by all personalized rows. */
function Shelf({
    icon: Icon,
    label,
    children,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    children: React.ReactNode;
}) {
    return (
        <section className="space-y-3" data-tv-section>
            <div className="flex items-center gap-3">
                <div className="h-px w-8 bg-primary" />
                <span className="flex items-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground">
                    <Icon className="size-3" />
                    {label}
                </span>
            </div>
            {children}
        </section>
    );
}

function ShelfCarousel({ items, type, watchedIds }: { items: TraktMedia[]; type: "movie" | "show"; watchedIds: Set<string> }) {
    if (items.length === 0) return null;
    return (
        <ScrollCarousel>
            <div className="flex gap-3 pb-2">
                {items.slice(0, 20).map((media) => (
                    <div key={`${type}-${media.ids?.slug ?? media.ids?.imdb}`} className="w-[140px] shrink-0">
                        <MediaCard
                            media={media}
                            type={type}
                            watched={!!media.ids?.imdb && watchedIds.has(media.ids.imdb)}
                        />
                    </div>
                ))}
            </div>
        </ScrollCarousel>
    );
}

/** "Because you watched X" — uses Trakt `related` for the last-seen title. */
function BecauseYouWatchedShelf({ watchedIds }: { watchedIds: Set<string> }) {
    const { data: history } = useHistoryPage();
    const anchor = history?.history?.[0];
    const anchorId = anchor?.imdbId ?? "";
    const anchorType = (anchor?.type ?? "movie") as "movie" | "show";
    const { data: anchorMedia } = useTraktMedia(anchorId, anchorType);
    const { data: related = [] } = useTraktRelated(anchorId, anchorType);

    const anchorTitle = anchorMedia?.title ?? "your last watch";
    if (!anchor || related.length === 0) return null;
    return (
        <Shelf icon={Sparkles} label={`Because you watched ${anchorTitle}`}>
            <ShelfCarousel items={related} type={anchorType} watchedIds={watchedIds} />
        </Shelf>
    );
}

/** "Re-watch" — titles watched once > 6 months ago, unique. */
function RewatchShelf({ watchedIds }: { watchedIds: Set<string> }) {
    const { data: history } = useHistoryPage();
    // Fixed cutoff computed once on mount to keep render pure.
    const [cutoff] = useState(() => Date.now() - SIX_MONTHS_MS);
    const candidates = useMemo(() => {
        if (!history?.history) return [];
        const seen = new Set<string>();
        const out: HistoryEntry[] = [];
        for (const e of history.history) {
            if (new Date(e.watchedAt).getTime() > cutoff) continue;
            if (seen.has(e.imdbId)) continue;
            seen.add(e.imdbId);
            out.push(e);
            if (out.length >= 12) break;
        }
        return out;
    }, [history, cutoff]);

    if (candidates.length === 0) return null;
    return (
        <Shelf icon={RotateCcw} label="Re-watch">
            <ScrollCarousel>
                <div className="flex gap-3 pb-2">
                    {candidates.map((entry) => (
                        <RewatchCard key={`rewatch-${entry.id}`} entry={entry} watchedIds={watchedIds} />
                    ))}
                </div>
            </ScrollCarousel>
        </Shelf>
    );
}

function RewatchCard({ entry, watchedIds }: { entry: HistoryEntry; watchedIds: Set<string> }) {
    const { data: media } = useTraktMedia(entry.imdbId, entry.type);
    if (!media) return null;
    return (
        <div className="w-[140px] shrink-0">
            <MediaCard media={media} type={entry.type} watched={watchedIds.has(entry.imdbId)} />
        </div>
    );
}

/** "Hidden gems" — Trakt popular items with rating >= 7.5. */
function HiddenGemsShelf({ watchedIds }: { watchedIds: Set<string> }) {
    const { data: popularMovies = [] } = useTraktPopularMovies(40);
    const { data: popularShows = [] } = useTraktPopularShows(40);

    const gemsMovies = useMemo<TraktMedia[]>(
        () => popularMovies
            .map((item: TraktMediaItem) => item.movie)
            .filter((m): m is TraktMedia => !!m && (m.rating ?? 0) >= 7.5)
            .slice(0, 12),
        [popularMovies]
    );
    const gemsShows = useMemo<TraktMedia[]>(
        () => popularShows
            .map((item: TraktMediaItem) => item.show)
            .filter((m): m is TraktMedia => !!m && (m.rating ?? 0) >= 7.5)
            .slice(0, 12),
        [popularShows]
    );

    if (gemsMovies.length === 0 && gemsShows.length === 0) return null;
    return (
        <Shelf icon={Gem} label="Hidden gems">
            {gemsMovies.length > 0 && (
                <div className="space-y-1.5">
                    <span className="text-[10px] tracking-widest uppercase text-muted-foreground/60 ml-11">Movies</span>
                    <ShelfCarousel items={gemsMovies} type="movie" watchedIds={watchedIds} />
                </div>
            )}
            {gemsShows.length > 0 && (
                <div className="space-y-1.5">
                    <span className="text-[10px] tracking-widest uppercase text-muted-foreground/60 ml-11">TV Shows</span>
                    <ShelfCarousel items={gemsShows} type="show" watchedIds={watchedIds} />
                </div>
            )}
        </Shelf>
    );
}

const ForYouPage = memo(function ForYouPage() {
    const [movieLimit, setMovieLimit] = useState(INITIAL_LIMIT);
    const [showLimit, setShowLimit] = useState(INITIAL_LIMIT);

    const { data: movies, isLoading: moviesLoading, isFetching: moviesFetching, isError: moviesError } = useRecommendationsByType("movies", movieLimit);
    const { data: shows, isLoading: showsLoading, isFetching: showsFetching, isError: showsError } = useRecommendationsByType("shows", showLimit);
    const watchedIds = useWatchedIds();

    const movieItems = useMemo(() => movies ?? [], [movies]);
    const showItems = useMemo(() => shows ?? [], [shows]);
    const hasMoreMovies = movieItems.length >= movieLimit;
    const hasMoreShows = showItems.length >= showLimit;

    const loadMoreMovies = useCallback(() => setMovieLimit((prev) => prev + LOAD_MORE_LIMIT), []);
    const loadMoreShows = useCallback(() => setShowLimit((prev) => prev + LOAD_MORE_LIMIT), []);

    const isLoading = moviesLoading && showsLoading && movieItems.length === 0 && showItems.length === 0;
    const isEmpty = !moviesLoading && !showsLoading && movieItems.length === 0 && showItems.length === 0;
    const isError = isEmpty && (moviesError || showsError);

    return (
        <div className="space-y-10 py-6 lg:px-6">
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

            {/* Personalized horizontal shelves (fail silent if source data unavailable) */}
            <BecauseYouWatchedShelf watchedIds={watchedIds} />
            <RewatchShelf watchedIds={watchedIds} />
            <HiddenGemsShelf watchedIds={watchedIds} />

            {isLoading ? (
                <LoadingState label="Loading recommendations..." className="py-24" />
            ) : isError ? (
                <EmptyState
                    title="Failed to load recommendations"
                    description="Could not reach Trakt. Check your connection and try again."
                    className="py-14"
                />
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
