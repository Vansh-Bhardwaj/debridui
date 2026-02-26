"use client";
export const dynamic = "force-static";

import { useState, useCallback, memo, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/common/page-header";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/async-state";
import { Button } from "@/components/ui/button";
import { useTraktMedia } from "@/hooks/use-trakt";
import { getPosterUrl } from "@/lib/utils/media";
import { History, Trash2, X, Play, Film, Tv, Clock, Clapperboard, Calendar, ChevronDown } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";
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

interface HistoryTitleGroup {
    key: string;
    entries: HistoryEntry[];
    /** Entry with highest progress % (shown as primary) */
    primary: HistoryEntry;
    totalWatchTime: number;
}

/** Sub-group entries within a date by imdbId + episode to collapse duplicates */
function groupByTitle(entries: HistoryEntry[]): HistoryTitleGroup[] {
    const map = new Map<string, HistoryEntry[]>();
    for (const entry of entries) {
        const key = entry.type === "show" && entry.season != null && entry.episode != null
            ? `${entry.imdbId}:s${entry.season}e${entry.episode}`
            : entry.imdbId;
        const group = map.get(key);
        if (group) group.push(entry);
        else map.set(key, [entry]);
    }
    const result: HistoryTitleGroup[] = [];
    for (const [key, group] of map) {
        const primary = group.reduce((best, e) =>
            e.durationSeconds > 0 && (e.progressSeconds / e.durationSeconds) > (best.durationSeconds > 0 ? best.progressSeconds / best.durationSeconds : 0) ? e : best
        , group[0]);
        result.push({
            key,
            entries: group,
            primary,
            totalWatchTime: group.reduce((sum, e) => sum + e.progressSeconds, 0),
        });
    }
    return result;
}

interface HistoryItemProps {
    entry: HistoryEntry;
    onDelete: (id: string) => void;
    /** Session count badge for grouped entries */
    sessionCount?: number;
    sessionExpanded?: boolean;
    onToggleSessions?: () => void;
}

const HistoryItem = memo(function HistoryItem({ entry, onDelete, sessionCount, sessionExpanded, onToggleSessions }: HistoryItemProps) {
    const { data: media } = useTraktMedia(entry.imdbId, entry.type);
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
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
        <div className={cn(
                "group flex items-center gap-4 rounded-sm border border-border/50 bg-card/30 hover:bg-card/60 transition-colors",
                tvMode ? "p-4 gap-5" : "p-3"
            )}
            data-tv-focusable="list"
            tabIndex={0}
        >
            {/* Poster */}
            <Link href={mediaHref} className="shrink-0">
                <div className={cn(
                    "relative rounded-sm overflow-hidden bg-muted border border-border/50",
                    tvMode ? "w-14 h-[84px]" : "w-10 h-[60px]"
                )}>
                    <Image
                        src={posterUrl}
                        alt={title}
                        fill
                        sizes={tvMode ? "56px" : "40px"}
                        className="object-cover"
                        unoptimized
                    />
                </div>
            </Link>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                    <Link href={mediaHref} className={cn(
                        "truncate font-medium hover:text-primary transition-colors",
                        tvMode ? "text-base" : "text-sm"
                    )}>
                        {title}
                    </Link>
                    {entry.type === "movie"
                        ? <Film className={cn("text-muted-foreground/60 shrink-0", tvMode ? "size-4" : "size-3")} />
                        : <Tv className={cn("text-muted-foreground/60 shrink-0", tvMode ? "size-4" : "size-3")} />}
                </div>
                <div className={cn(
                    "flex items-center gap-2 mt-0.5 text-muted-foreground",
                    tvMode ? "text-xs" : "text-[11px]"
                )}>
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
                <div className={cn(
                    "mt-1.5 bg-muted rounded-full overflow-hidden",
                    tvMode ? "h-1 w-48" : "h-0.5 w-32"
                )}>
                    <div
                        className="h-full bg-primary/70 rounded-full"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
            </div>

            {/* Actions — always visible in TV mode (no hover) */}
            <div className={cn(
                "shrink-0 flex items-center gap-2 transition-opacity",
                tvMode ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}>
                {sessionCount && sessionCount > 1 && onToggleSessions && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleSessions(); }}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground rounded-sm hover:bg-muted/30 transition-colors"
                        aria-expanded={sessionExpanded}
                    >
                        <ChevronDown className={cn("size-3 transition-transform duration-200", sessionExpanded && "rotate-180")} />
                        <span className="whitespace-nowrap">{sessionCount} sessions</span>
                    </button>
                )}
                <Link href={mediaHref}>
                    <Button variant="ghost" size="icon" className={tvMode ? "size-9" : "size-7"}>
                        <Play className={tvMode ? "size-4" : "size-3.5"} />
                    </Button>
                </Link>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("text-muted-foreground hover:text-destructive", tvMode ? "size-9" : "size-7")}
                    onClick={() => onDelete(entry.id)}
                    aria-label="Remove entry"
                >
                    <X className={tvMode ? "size-4" : "size-3.5"} />
                </Button>
            </div>
        </div>
    );
});

/** Grouped history row: shows primary entry with collapse/expand for multiple sessions */
const HistoryGroupRow = memo(function HistoryGroupRow({
    group,
    onDelete,
}: {
    group: HistoryTitleGroup;
    onDelete: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const hasMultiple = group.entries.length > 1;

    if (!hasMultiple) {
        return <HistoryItem entry={group.primary} onDelete={onDelete} />;
    }

    return (
        <div className="space-y-1.5">
            <HistoryItem
                entry={group.primary}
                onDelete={onDelete}
                sessionCount={group.entries.length}
                sessionExpanded={expanded}
                onToggleSessions={() => setExpanded((v) => !v)}
            />

            {/* Expanded sub-entries (excluding primary) */}
            {expanded && (
                <div className="ml-6 sm:ml-8 border-l border-border/30 pl-3 space-y-1.5">
                    {group.entries
                        .filter((e) => e.id !== group.primary.id)
                        .map((entry) => (
                            <HistoryItem key={entry.id} entry={entry} onDelete={onDelete} />
                        ))}
                </div>
            )}
        </div>
    );
});

const PAGE_SIZE = 50;

function updateHistoryCaches(
    queryClient: ReturnType<typeof useQueryClient>,
    updater: (old: { history: HistoryEntry[]; total: number }) => { history: HistoryEntry[]; total: number }
) {
    queryClient.setQueriesData<{ history: HistoryEntry[]; total: number }>(
        { queryKey: ["watch-history"] },
        (old) => {
            if (!old) return old;
            return updater(old);
        }
    );
}

export default function HistoryPage() {
    const queryClient = useQueryClient();
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [clearOpen, setClearOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    const { data, isLoading, error } = useQuery<{ history: HistoryEntry[]; total: number }>({
        queryKey: ["watch-history", limit],
        queryFn: async () => {
            const res = await fetch(`/api/history?limit=${limit}&offset=0`);
            if (!res.ok) {
                throw new Error("Failed to fetch watch history");
            }
            return res.json() as Promise<{ history: HistoryEntry[]; total: number }>;
        },
        staleTime: 30_000,
    });

    const entries = data?.history ?? [];
    const total = data?.total ?? 0;
    const groups = groupByDate(entries);
    const dateKeys = Object.keys(groups);
    const titleGroupsByDate = useMemo(() => {
        const result: Record<string, HistoryTitleGroup[]> = {};
        for (const [date, dateEntries] of Object.entries(groups)) {
            result[date] = groupByTitle(dateEntries);
        }
        return result;
    }, [groups]);

    const handleDelete = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/history?id=${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Failed");
            setActionError(null);
            updateHistoryCaches(queryClient, (old) => {
                const nextHistory = old.history.filter((e) => e.id !== id);
                const removed = old.history.length - nextHistory.length;
                return {
                    history: nextHistory,
                    total: Math.max(0, old.total - removed),
                };
            });
        } catch {
            setActionError("Failed to remove entry. Please try again.");
        }
    }, [queryClient]);

    const handleClearAll = useCallback(async () => {
        setClearing(true);
        try {
            const res = await fetch("/api/history", { method: "DELETE" });
            if (!res.ok) throw new Error("Failed");
            setActionError(null);
            queryClient.setQueriesData<{ history: HistoryEntry[]; total: number }>(
                { queryKey: ["watch-history"] },
                (old) => old ? { history: [], total: 0 } : old
            );
            setClearOpen(false);
        } catch {
            setActionError("Failed to clear history. Please try again.");
        } finally {
            setClearing(false);
        }
    }, [queryClient]);

    const handleLoadMore = () => setLimit((prev) => prev + PAGE_SIZE);

    return (
        <div className={cn(
            "mx-auto w-full space-y-8 pb-16",
            tvMode ? "max-w-6xl" : "max-w-4xl"
        )}>
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

            {actionError && (
                <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {actionError}
                </div>
            )}

            {isLoading && <LoadingState label="Loading watch history..." />}
            {error && <ErrorState title="Failed to load watch history" description="Please try refreshing the page" />}

            {!isLoading && !error && entries.length === 0 && (
                <EmptyState
                    title="No watch history yet"
                    description="Videos you watch will appear here"
                />
            )}

            {!isLoading && !error && entries.length > 0 && (
                <>
                    {/* Stats row */}
                    <div className={cn("grid grid-cols-2 sm:grid-cols-4", tvMode ? "gap-4" : "gap-3")} data-tv-section>
                        {[
                            { icon: History, label: "Sessions", value: total > entries.length ? `${entries.length} of ${total}` : entries.length.toString() },
                            { icon: Clapperboard, label: "Titles", value: new Set(entries.map((e: HistoryEntry) => e.imdbId)).size.toString() },
                            { icon: Clock, label: "Watch Time", value: formatDuration(entries.reduce((acc: number, e: HistoryEntry) => acc + e.progressSeconds, 0)) },
                            { icon: Calendar, label: "This Week", value: entries.filter((e: HistoryEntry) => {
                                const d = new Date(e.watchedAt);
                                const now = new Date();
                                return now.getTime() - d.getTime() < 7 * 24 * 60 * 60 * 1000;
                            }).length.toString() },
                        ].map(({ icon: Icon, label, value }) => (
                            <div key={label} className={cn(
                                "rounded-sm border border-border/50 bg-card/30 flex items-center gap-3",
                                tvMode ? "p-4" : "p-3"
                            )}>
                                <Icon className={cn("text-muted-foreground shrink-0", tvMode ? "size-5" : "size-4")} />
                                <div>
                                    <p className={cn("tracking-widest uppercase text-muted-foreground", tvMode ? "text-sm" : "text-xs")}>{label}</p>
                                    <p className={cn("font-medium", tvMode ? "text-base" : "text-sm")}>{value}</p>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-8">
                    {dateKeys.map((dateKey) => (
                        <section key={dateKey} className="space-y-2" data-tv-section>
                            <div className="flex items-center gap-3 py-1">
                                <div className="h-px flex-1 bg-border/50" />
                                <span className="text-xs tracking-widest uppercase text-muted-foreground px-2">
                                    {dateKey}
                                </span>
                                <div className="h-px flex-1 bg-border/50" />
                            </div>
                            <div className="space-y-2" data-tv-stagger>
                                {(titleGroupsByDate[dateKey] ?? []).map((group, i) => (
                                    <div
                                        key={group.key}
                                        className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
                                        style={{ animationDelay: `${Math.min(i * 50, 300)}ms`, animationFillMode: "backwards" }}
                                    >
                                        <HistoryGroupRow group={group} onDelete={handleDelete} />
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}

                    {entries.length < total && (
                        <div className="flex flex-col items-center gap-1 pt-4">
                            <Button variant="outline" size="sm" onClick={handleLoadMore}>
                                Load more
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                Showing {entries.length} of {total}
                            </span>
                        </div>
                    )}
                </div>
                </>
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
