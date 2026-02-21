"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { PageHeader } from "@/components/common/page-header";
import { MediaSection } from "@/components/mdb/media-section";
import { MediaCard } from "@/components/mdb/media-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    useTraktWatchlistMovies,
    useTraktWatchlistShows,
    useTraktCalendarShows,
    useTraktCalendarMovies,
    useTraktRecentEpisodes,
    useTraktFavoritesMovies,
    useTraktFavoritesShows,
} from "@/hooks/use-trakt";
import { useUserSettings } from "@/hooks/use-user-settings";
import { Bookmark, CalendarDays, Film, Tv, LinkIcon, ChevronDown, Bell, Monitor, Clapperboard, Clock, Heart } from "lucide-react";
import { type TraktCalendarItem, type TraktWatchlistItem, type TraktMedia, type TraktFavoriteItem } from "@/lib/trakt";
import Link from "next/link";
import Image from "next/image";
import { SectionErrorBoundary } from "@/components/common/error-boundary";
import { cn } from "@/lib/utils";
import { getPosterUrl } from "@/lib/utils/media";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/async-state";

// ── Watchlist Filters ──────────────────────────────────────────────────────

type WatchlistFilter = "all" | "digital" | "in-cinema" | "upcoming";

const FILTERS: { id: WatchlistFilter; label: string; icon: typeof Bookmark }[] = [
    { id: "all", label: "All", icon: Bookmark },
    { id: "digital", label: "Digital Release", icon: Monitor },
    { id: "in-cinema", label: "In Cinemas", icon: Clapperboard },
    { id: "upcoming", label: "Upcoming", icon: Clock },
];

// Typical theatrical-to-digital window ~45 days, in-cinema window ~90 days
const DIGITAL_THRESHOLD_DAYS = 45;
const CINEMA_WINDOW_DAYS = 90;

function daysSinceRelease(media: TraktMedia): number | null {
    const dateStr = media.released ?? media.first_aired;
    if (!dateStr) return null;
    const released = new Date(dateStr);
    if (isNaN(released.getTime())) return null;
    return Math.floor((Date.now() - released.getTime()) / 86400000);
}

function matchesFilter(media: TraktMedia, type: "movie" | "show", filter: WatchlistFilter): boolean {
    if (filter === "all") return true;

    const status = media.status?.toLowerCase();
    const days = daysSinceRelease(media);

    if (type === "show") {
        switch (filter) {
            case "digital":
                // Shows are available digitally if they have aired episodes
                return status === "returning series" || status === "ended" || status === "canceled"
                    || (media.aired_episodes != null && media.aired_episodes > 0);
            case "in-cinema":
                // Shows don't have cinema releases
                return false;
            case "upcoming":
                return status === "in production" || status === "planned" || status === "pilot"
                    || status === "upcoming" || (days !== null && days < 0);
        }
    }

    // Movies
    switch (filter) {
        case "digital":
            // Released more than DIGITAL_THRESHOLD_DAYS ago → likely available digitally
            return status === "released" && days !== null && days >= DIGITAL_THRESHOLD_DAYS;
        case "in-cinema":
            // Released within CINEMA_WINDOW_DAYS → likely still in theaters
            return status === "released" && days !== null && days >= 0 && days < CINEMA_WINDOW_DAYS;
        case "upcoming":
            // Not yet released
            return status !== "released" && status !== "canceled"
                || (days !== null && days < 0);
    }
}

// Group calendar items by date
function groupByDate(items: TraktCalendarItem[]): Record<string, TraktCalendarItem[]> {
    const groups: Record<string, TraktCalendarItem[]> = {};
    for (const item of items) {
        const date = item.first_aired?.split("T")[0] ?? item.released ?? "Unknown";
        (groups[date] ??= []).push(item);
    }
    return groups;
}

function formatDate(iso: string): string {
    const d = new Date(iso + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = d.getTime() - today.getTime();
    const days = Math.round(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days === -1) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

const CalendarSection = memo(function CalendarSection({
    items,
    isLoading,
    error,
    emptyMessage,
}: {
    items?: TraktCalendarItem[];
    isLoading: boolean;
    error: Error | null;
    emptyMessage: string;
}) {
    const grouped = useMemo(() => (items ? groupByDate(items) : {}), [items]);
    const sortedDates = useMemo(() => Object.keys(grouped).sort(), [grouped]);

    if (isLoading) {
        return (
            <LoadingState label="Loading calendar..." className="py-12" />
        );
    }

    if (error) {
        return <ErrorState title="Failed to load calendar" description="Please retry in a moment." className="py-12" />;
    }

    if (sortedDates.length === 0) {
        return <EmptyState title={emptyMessage} className="py-12" />;
    }

    return (
        <div className="space-y-8">
            {sortedDates.map((date) => (
                <div key={date} className="space-y-3">
                    <h3 className="text-xs tracking-widest uppercase text-muted-foreground">{formatDate(date)}</h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(175px,1fr))] 2xl:grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                        {grouped[date].map((item, i) => {
                            const media = item.movie || item.show;
                            const type = item.movie ? "movie" : "show";
                            if (!media) return null;
                            return (
                                <div
                                    key={`${type}-${media.ids?.trakt || i}`}
                                    className="animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                                    style={{ animationDelay: `${Math.min(i * 30, 200)}ms`, animationDuration: "400ms", animationFillMode: "backwards" }}>
                                    <MediaCard media={media} type={type as "movie" | "show"} />
                                    {item.episode && (
                                        <p className="text-xs text-muted-foreground mt-1.5 truncate">
                                            S{item.episode.season}E{item.episode.number} — {item.episode.title}
                                        </p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
});

/** Recently aired episodes — expandable editorial section */
const RecentlyAiredSection = memo(function RecentlyAiredSection({
    items,
    count,
}: {
    items: TraktCalendarItem[];
    count: number;
}) {
    const [expanded, setExpanded] = useState(false);

    const sorted = useMemo(
        () =>
            [...items]
                .filter((i) => {
                    const aired = i.first_aired ? new Date(i.first_aired).getTime() : 0;
                    return aired > 0 && aired <= new Date().getTime();
                })
                .sort((a, b) => {
                    const aTime = a.first_aired ? new Date(a.first_aired).getTime() : 0;
                    const bTime = b.first_aired ? new Date(b.first_aired).getTime() : 0;
                    return bTime - aTime;
                }),
        [items]
    );

    if (count === 0) return null;

    return (
        <section className="space-y-4">
            {/* Editorial section header */}
            <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-3 w-full group"
                aria-expanded={expanded}>
                <div className="h-px w-6 bg-primary" />
                <Bell className="size-3.5 text-primary" />
                <span className="text-xs tracking-widest uppercase text-muted-foreground">
                    {count} Recently Aired
                </span>
                <div className="h-px flex-1 bg-border/50" />
                <ChevronDown
                    className={cn(
                        "size-3.5 text-muted-foreground transition-transform duration-300",
                        expanded && "rotate-180"
                    )}
                />
            </button>

            {/* Episode cards */}
            {expanded && (
                <div className="grid gap-1.5">
                    {sorted.map((item, i) => {
                        const show = item.show;
                        const ep = item.episode;
                        if (!show || !ep) return null;
                        const slug = show.ids?.slug || show.ids?.trakt;
                        const posterUrl =
                            getPosterUrl(show.images) ||
                            `https://placehold.co/48x72/1a1a1a/333?text=${encodeURIComponent(show.title?.charAt(0) || "?")}`;
                        const airedDate = item.first_aired
                            ? formatDate(item.first_aired.split("T")[0] ?? "")
                            : "";

                        return (
                            <Link
                                key={`${show.ids?.trakt}-${ep.season}-${ep.number}`}
                                href={`/shows/${slug}?season=${ep.season}`}
                                className="group/item flex items-center gap-3.5 px-3 py-2.5 rounded-sm hover:bg-muted/30 transition-colors duration-300 animate-in fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
                                style={{
                                    animationDelay: `${Math.min(i * 40, 300)}ms`,
                                    animationDuration: "400ms",
                                    animationFillMode: "backwards",
                                }}>
                                {/* Poster thumbnail */}
                                <div className="relative w-9 h-[54px] shrink-0 rounded-sm overflow-hidden bg-muted/30">
                                    <Image
                                        src={posterUrl}
                                        alt={show.title}
                                        fill
                                        sizes="36px"
                                        className="object-cover"
                                        unoptimized
                                    />
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0 space-y-0.5">
                                    <p className="text-sm font-medium truncate">{show.title}</p>
                                    <span className="text-xs text-muted-foreground truncate block">
                                        S{String(ep.season).padStart(2, "0")}E{String(ep.number).padStart(2, "0")}
                                        {ep.title && (
                                            <>
                                                <span className="text-border"> · </span>
                                                {ep.title}
                                            </>
                                        )}
                                    </span>
                                </div>

                                {/* Date badge */}
                                <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
                                    {airedDate}
                                </span>
                            </Link>
                        );
                    })}
                </div>
            )}
        </section>
    );
});

const WatchlistPage = memo(function WatchlistPage() {
    const { data: settings } = useUserSettings();
    const isTraktConnected = !!settings?.trakt_access_token;
    const [filter, setFilter] = useState<WatchlistFilter>("all");

    const watchlistMovies = useTraktWatchlistMovies();
    const watchlistShows = useTraktWatchlistShows();
    const calendarShows = useTraktCalendarShows();
    const calendarMovies = useTraktCalendarMovies();
    const recentEpisodes = useTraktRecentEpisodes(7);
    const favoritesMovies = useTraktFavoritesMovies();
    const favoritesShows = useTraktFavoritesShows();

    // Count recently aired episodes (past 7 days, only those already aired)
    const recentCount = useMemo(() => {
        if (!recentEpisodes.data) return 0;
        return recentEpisodes.data.filter((item) => {
            const aired = item.first_aired ? new Date(item.first_aired).getTime() : 0;
            return aired > 0 && aired <= new Date().getTime();
        }).length;
    }, [recentEpisodes.data]);

    // Apply filter to watchlist items
    const filterWatchlist = useCallback(
        (items: TraktWatchlistItem[] | undefined, type: "movie" | "show") => {
            if (!items) return undefined;
            if (filter === "all") return items;
            return items.filter((item) => {
                const media = type === "movie" ? item.movie : item.show;
                return media && matchesFilter(media, type, filter);
            });
        },
        [filter]
    );

    // Convert watchlist items → TraktMediaItem-compatible for MediaSection
    const movieItems = useMemo(
        () => filterWatchlist(watchlistMovies.data, "movie")?.filter((i) => i.movie).map((i) => ({ movie: i.movie, show: undefined })),
        [watchlistMovies.data, filterWatchlist]
    );
    const showItems = useMemo(
        () => filterWatchlist(watchlistShows.data, "show")?.filter((i) => i.show).map((i) => ({ show: i.show, movie: undefined })),
        [watchlistShows.data, filterWatchlist]
    );

    // Convert favorite items → TraktMediaItem-compatible for MediaSection
    const favMovieItems = useMemo(
        () => (favoritesMovies.data as TraktFavoriteItem[] | undefined)
            ?.filter((i) => i.movie)
            .map((i) => ({ movie: i.movie, show: undefined })),
        [favoritesMovies.data]
    );
    const favShowItems = useMemo(
        () => (favoritesShows.data as TraktFavoriteItem[] | undefined)
            ?.filter((i) => i.show)
            .map((i) => ({ show: i.show, movie: undefined })),
        [favoritesShows.data]
    );

    // Count per filter for badges
    const filterCounts = useMemo(() => {
        const movies = watchlistMovies.data ?? [];
        const shows = watchlistShows.data ?? [];
        const counts: Record<WatchlistFilter, number> = { all: movies.length + shows.length, digital: 0, "in-cinema": 0, upcoming: 0 };
        for (const item of movies) {
            if (item.movie) {
                for (const f of ["digital", "in-cinema", "upcoming"] as const) {
                    if (matchesFilter(item.movie, "movie", f)) counts[f]++;
                }
            }
        }
        for (const item of shows) {
            if (item.show) {
                for (const f of ["digital", "in-cinema", "upcoming"] as const) {
                    if (matchesFilter(item.show, "show", f)) counts[f]++;
                }
            }
        }
        return counts;
    }, [watchlistMovies.data, watchlistShows.data]);

    if (!isTraktConnected) {
        return (
            <div className="space-y-6">
                <PageHeader icon={Bookmark} title="Watchlist & Favorites" description="Your Trakt watchlist, favorites, and upcoming calendar." />
                <div className="flex flex-col items-center justify-center py-16 space-y-4 text-center">
                    <Bookmark className="size-12 text-muted-foreground/40" strokeWidth={1} />
                    <p className="text-sm text-muted-foreground max-w-sm">
                        Connect your Trakt account in Settings to see your watchlist and upcoming releases.
                    </p>
                    <Link
                        href="/settings"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                        <LinkIcon className="size-3.5" />
                        Go to Settings
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader icon={Bookmark} title="Watchlist & Favorites" description="Your Trakt watchlist, favorites, and upcoming calendar." />

            {recentCount > 0 && recentEpisodes.data && (
                <RecentlyAiredSection items={recentEpisodes.data} count={recentCount} />
            )}

            <Tabs defaultValue="watchlist">
                <TabsList variant="line">
                    <TabsTrigger value="watchlist" className="gap-1.5">
                        <Bookmark className="size-3.5" />
                        Watchlist
                    </TabsTrigger>
                    <TabsTrigger value="favorites" className="gap-1.5">
                        <Heart className="size-3.5" />
                        Favorites
                    </TabsTrigger>
                    <TabsTrigger value="calendar" className="gap-1.5">
                        <CalendarDays className="size-3.5" />
                        Calendar
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="watchlist" className="space-y-8 pt-6">
                    {/* Filter chips */}
                    <div className="flex flex-wrap items-center gap-2">
                        {FILTERS.map((f) => {
                            const Icon = f.icon;
                            const count = filterCounts[f.id];
                            const isActive = filter === f.id;
                            return (
                                <button
                                    key={f.id}
                                    onClick={() => setFilter(f.id)}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-sm border transition-colors duration-200",
                                        isActive
                                            ? "bg-primary/10 border-primary/30 text-primary"
                                            : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                                    )}>
                                    <Icon className="size-3.5" />
                                    {f.label}
                                    {f.id !== "all" && count > 0 && (
                                        <span className={cn(
                                            "ml-0.5 tabular-nums",
                                            isActive ? "text-primary/70" : "text-muted-foreground/50"
                                        )}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <SectionErrorBoundary section="Watchlist Movies">
                        <MediaSection
                            title="Movies"
                            items={movieItems}
                            isLoading={watchlistMovies.isLoading}
                            error={watchlistMovies.error}
                            rows={2}
                        />
                    </SectionErrorBoundary>
                    {/* Shows aren't shown in cinema — hide section for that filter */}
                    {filter !== "in-cinema" && (
                        <SectionErrorBoundary section="Watchlist Shows">
                            <MediaSection
                                title="TV Shows"
                                items={showItems}
                                isLoading={watchlistShows.isLoading}
                                error={watchlistShows.error}
                                rows={2}
                            />
                        </SectionErrorBoundary>
                    )}
                    {filter !== "all" && !watchlistMovies.isLoading && !watchlistShows.isLoading
                        && (movieItems?.length === 0) && (filter === "in-cinema" || showItems?.length === 0) && (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                            No items match the selected filter
                        </p>
                    )}
                </TabsContent>

                <TabsContent value="favorites" className="space-y-8 pt-6">
                    <SectionErrorBoundary section="Favorite Movies">
                        <MediaSection
                            title="Movies"
                            items={favMovieItems}
                            isLoading={favoritesMovies.isLoading}
                            error={favoritesMovies.error}
                            rows={2}
                        />
                    </SectionErrorBoundary>
                    <SectionErrorBoundary section="Favorite Shows">
                        <MediaSection
                            title="TV Shows"
                            items={favShowItems}
                            isLoading={favoritesShows.isLoading}
                            error={favoritesShows.error}
                            rows={2}
                        />
                    </SectionErrorBoundary>
                    {!favoritesMovies.isLoading && !favoritesShows.isLoading
                        && !favMovieItems?.length && !favShowItems?.length && (
                        <EmptyState title="No favorites yet" description="Heart a movie or show to add it to your favorites." className="py-12" />
                    )}
                </TabsContent>

                <TabsContent value="calendar" className="space-y-10 pt-6">
                    <SectionErrorBoundary section="Calendar Shows">
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Tv className="size-4 text-primary" />
                                <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Upcoming Shows</h2>
                            </div>
                            <CalendarSection
                                items={calendarShows.data}
                                isLoading={calendarShows.isLoading}
                                error={calendarShows.error}
                                emptyMessage="No upcoming shows in your calendar"
                            />
                        </div>
                    </SectionErrorBoundary>

                    <SectionErrorBoundary section="Calendar Movies">
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <Film className="size-4 text-primary" />
                                <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Upcoming Movies</h2>
                            </div>
                            <CalendarSection
                                items={calendarMovies.data}
                                isLoading={calendarMovies.isLoading}
                                error={calendarMovies.error}
                                emptyMessage="No upcoming movies in your calendar"
                            />
                        </div>
                    </SectionErrorBoundary>
                </TabsContent>
            </Tabs>
        </div>
    );
});

export default WatchlistPage;
