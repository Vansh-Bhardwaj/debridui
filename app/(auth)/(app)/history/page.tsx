"use client";

import { useState, useCallback, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/common/page-header";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/async-state";
import { Button } from "@/components/ui/button";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { History, Trash2, X, Play, Film, Tv } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import Link from "next/link";
import { format, isToday, isYesterday } from "date-fns";

interface HistoryEntry {
    id: string;
    imdbId: string;
    type: "movie" | "show";
    season: number | null;
    episode: number | null;
    fileName: string | null;
    progressSeconds: number;
    durationSeconds: number;
    watchedAt: string;
}

function formatDuration(seconds: number) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function formatGroupDate(dateStr: string): string {
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "MMMM d, yyyy");
}

function groupByDate(entries: HistoryEntry[]): Record<string, HistoryEntry[]> {
    const groups: Record<string, HistoryEntry[]> = {};
    for (const entry of entries) {
        const key = formatGroupDate(entry.watchedAt);
        if (!groups[key]) groups[key] = [];
        groups[key].push(entry);
    }
    return groups;
}

interface HistoryItemProps {
    entry: HistoryEntry;
    onDelete: (id: string) => void;
}

const HistoryItem = memo(function HistoryItem({ entry, onDelete }: HistoryItemProps) {
    const { data: media } = useTraktMedia(entry.imdbId, entry.type);
    const progressPercent = entry.durationSeconds > 0
        ? Math.min(Math.round((entry.progressSeconds / entry.durationSeconds) * 100), 100)
        : 0;

    const title = media?.title || entry.fileName || entry.imdbId;
    const posterUrl = getPosterUrl(media?.images) || `https://placehold.co/300x450/1a1a1a/3e3e3e?text=${encodeURIComponent(title)}`;
    const mediaSlug = media?.ids?.slug || media?.ids?.imdb;
    const mediaHref = mediaSlug ? `/${entry.type === "movie" ? "movies" : "shows"}/${mediaSlug}` : "#";
    const watchedTime = format(new Date(entry.watchedAt), "h:mm a");

    const episodeLabel = entry.type === "show" && entry.season && entry.episode
        ? `S${String(entry.season).padStart(2, "0")}E${String(entry.episode).padStart(2, "0")}`
        : null;

    return (
        <div className="group flex items-center gap-4 p-3 rounded-sm border border-border/50 bg-card/30 hover:bg-card/60 transition-colors">
            {/* Poster */}
            <Link href={mediaHref} className="shrink-0">
                <div className="relative w-10 h-[60px] rounded-sm overflow-hidden bg-muted border border-border/50">
                    <Image
                        src={posterUrl}
                        alt={title}
                        fill
                        sizes="40px"
                        className="object-cover"
                        unoptimized
                    />
                </div>
            </Link>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Link href={mediaHref} className="truncate text-sm font-medium hover:text-primary transition-colors">
                        {title}
                    </Link>
                    {entry.type === "movie"
                        ? <Film className="size-3 text-muted-foreground/60 shrink-0" />
                        : <Tv className="size-3 text-muted-foreground/60 shrink-0" />}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    {episodeLabel && <span className="font-mono">{episodeLabel}</span>}
                    {episodeLabel && <span className="text-border">·</span>}
                    <span>{formatDuration(entry.progressSeconds)} watched</span>
                    {entry.durationSeconds > 0 && (
                        <>
                            <span className="text-border">·</span>
                            <span>{formatDuration(entry.durationSeconds)} total</span>
                        </>
                    )}
                    <span className="text-border">·</span>
                    <span>{watchedTime}</span>
                </div>
                {/* Progress bar */}
                <div className="mt-1.5 h-0.5 bg-muted rounded-full overflow-hidden w-32">
                    <div
                        className="h-full bg-primary/70 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Actions */}
            <div className="shrink-0 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link href={mediaHref}>
                    <Button variant="ghost" size="icon" className="size-7">
                        <Play className="size-3.5" />
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(entry.id)}
                    aria-label="Remove entry"
                >
                    <X className="size-3.5" />
                </Button>
            </div>
        </div>
    );
});

const PAGE_SIZE = 50;

export default function HistoryPage() {
    const queryClient = useQueryClient();
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [clearOpen, setClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);

    const { data, isLoading, error } = useQuery<{ history: HistoryEntry[] }>({
        queryKey: ["watch-history", limit],
        queryFn: () =>
            fetch(`/api/history?limit=${limit}&offset=0`)
                .then((r) => r.json() as Promise<{ history: HistoryEntry[] }>),
        staleTime: 30_000,
    });

    const entries = data?.history ?? [];
    const groups = groupByDate(entries);
    const dateKeys = Object.keys(groups);

    const handleDelete = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/history?id=${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed");
            queryClient.setQueryData<{ history: HistoryEntry[] }>(
                ["watch-history", limit],
                (old) => old ? { history: old.history.filter((e) => e.id !== id) } : old
            );
        } catch {
            toast.error("Failed to remove entry");
        }
    }, [queryClient, limit]);

    const handleClearAll = useCallback(async () => {
        setClearing(true);
        try {
            const res = await fetch("/api/history", { method: "DELETE" });
            if (!res.ok) throw new Error("Failed");
            queryClient.setQueryData(["watch-history", limit], { history: [] });
            toast.success("Watch history cleared");
            setClearOpen(false);
        } catch {
            toast.error("Failed to clear history");
        } finally {
            setClearing(false);
        }
    }, [queryClient, limit]);

    const handleLoadMore = () => setLimit((prev) => prev + PAGE_SIZE);

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader
                icon={History}
                title="Watch History"
                description="Your previously watched movies and episodes"
                action={
                    entries.length > 0 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setClearOpen(true)}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <Trash2 className="size-3.5" />
                            Clear All
                        </Button>
                    ) : undefined
                }
            />

            {isLoading && <LoadingState label="Loading watch history..." />}
            {error && <ErrorState title="Failed to load watch history" description="Please try refreshing the page" />}

            {!isLoading && !error && entries.length === 0 && (
                <EmptyState
                    title="No watch history yet"
                    description="Videos you watch will appear here"
                />
            )}

            {!isLoading && !error && entries.length > 0 && (
                <div className="space-y-8">
                    {dateKeys.map((dateKey) => (
                        <section key={dateKey} className="space-y-2">
                            <div className="flex items-center gap-3 py-1">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-xs tracking-widest uppercase text-muted-foreground px-2">
                                    {dateKey}
                                </span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                            <div className="space-y-2">
                                {groups[dateKey].map((entry) => (
                                    <HistoryItem key={entry.id} entry={entry} onDelete={handleDelete} />
                                ))}
                            </div>
                        </section>
                    ))}

                    {entries.length >= limit && (
                        <div className="flex justify-center pt-4">
                            <Button variant="outline" size="sm" onClick={handleLoadMore}>
                                Load more
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <ConfirmDialog
                open={clearOpen}
                onOpenChange={setClearOpen}
                title="Clear watch history?"
                description="This will permanently delete all your watch history entries. This cannot be undone."
                confirmText="Clear All"
                variant="destructive"
                onConfirm={handleClearAll}
                isConfirming={clearing}
            />
        </div>
    );
}
