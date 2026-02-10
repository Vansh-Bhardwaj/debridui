"use client";

import { memo, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { MediaSection } from "@/components/mdb/media-section";
import { MediaCard } from "@/components/mdb/media-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
    useTraktWatchlistMovies,
    useTraktWatchlistShows,
    useTraktCalendarShows,
    useTraktCalendarMovies,
} from "@/hooks/use-trakt";
import { useUserSettings } from "@/hooks/use-user-settings";
import { Bookmark, CalendarDays, Film, Tv, LinkIcon } from "lucide-react";
import { type TraktCalendarItem } from "@/lib/trakt";
import Link from "next/link";

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
            <div className="space-y-6">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="space-y-3 animate-pulse">
                        <div className="h-4 w-32 bg-muted rounded" />
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                            {[1, 2, 3].map((j) => (
                                <div key={j} className="aspect-2/3 bg-muted rounded-sm" />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return <p className="text-sm text-muted-foreground py-8">Failed to load calendar</p>;
    }

    if (sortedDates.length === 0) {
        return <p className="text-sm text-muted-foreground py-8">{emptyMessage}</p>;
    }

    return (
        <div className="space-y-8">
            {sortedDates.map((date) => (
                <div key={date} className="space-y-3">
                    <h3 className="text-xs tracking-widest uppercase text-muted-foreground">{formatDate(date)}</h3>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                        {grouped[date].map((item, i) => {
                            const media = item.movie || item.show;
                            const type = item.movie ? "movie" : "show";
                            if (!media) return null;
                            return (
                                <div
                                    key={`${type}-${media.ids?.trakt || i}`}
                                    className="animate-in fade-in-0 slide-in-from-bottom-2"
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

const WatchlistPage = memo(function WatchlistPage() {
    const { data: settings } = useUserSettings();
    const isTraktConnected = !!settings?.trakt_access_token;

    const watchlistMovies = useTraktWatchlistMovies();
    const watchlistShows = useTraktWatchlistShows();
    const calendarShows = useTraktCalendarShows();
    const calendarMovies = useTraktCalendarMovies();

    // Convert watchlist items → TraktMediaItem-compatible for MediaSection
    const movieItems = useMemo(
        () => watchlistMovies.data?.filter((i) => i.movie).map((i) => ({ movie: i.movie, show: undefined })),
        [watchlistMovies.data]
    );
    const showItems = useMemo(
        () => watchlistShows.data?.filter((i) => i.show).map((i) => ({ show: i.show, movie: undefined })),
        [watchlistShows.data]
    );

    if (!isTraktConnected) {
        return (
            <div className="space-y-6">
                <PageHeader icon={Bookmark} title="Watchlist" description="Your Trakt watchlist and upcoming calendar." />
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
            <PageHeader icon={Bookmark} title="Watchlist" description="Your Trakt watchlist and upcoming calendar." />

            <Tabs defaultValue="watchlist">
                <TabsList variant="line">
                    <TabsTrigger value="watchlist" className="gap-1.5">
                        <Bookmark className="size-3.5" />
                        Watchlist
                    </TabsTrigger>
                    <TabsTrigger value="calendar" className="gap-1.5">
                        <CalendarDays className="size-3.5" />
                        Calendar
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="watchlist" className="space-y-8 pt-6">
                    <MediaSection
                        title="Movies"
                        items={movieItems}
                        isLoading={watchlistMovies.isLoading}
                        error={watchlistMovies.error}
                        rows={2}
                    />
                    <MediaSection
                        title="TV Shows"
                        items={showItems}
                        isLoading={watchlistShows.isLoading}
                        error={watchlistShows.error}
                        rows={2}
                    />
                </TabsContent>

                <TabsContent value="calendar" className="space-y-10 pt-6">
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
                </TabsContent>
            </Tabs>
        </div>
    );
});

export default WatchlistPage;
