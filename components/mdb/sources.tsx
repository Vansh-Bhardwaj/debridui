"use client";

import { useState, useMemo, useCallback, memo } from "react";
import { Resolution, type AddonSource, type TvSearchParams } from "@/lib/addons/types";
import { useAddonSources, useAddonSubtitles } from "@/hooks/use-addons";
import { Button } from "@/components/ui/button";
import { Plus, Loader2, HardDriveDownloadIcon, Trash2Icon, DownloadIcon, AlertTriangle, PlayIcon, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { useRouter } from "next/navigation";
import { CachedBadge } from "@/components/common/display";
import { useStreamingStore } from "@/lib/stores/streaming";

// Resolution filter tiers — exact match per tier, not "and above"
type ResolutionFilter = "4k" | "1080p" | "720p" | "all";

const RESOLUTION_FILTER_KEY = "debridui-resolution-filter";

/** Which tier a resolution belongs to */
const RESOLUTION_TIER: Record<string, ResolutionFilter> = {
    [Resolution.UHD_4K]: "4k",
    [Resolution.QHD_1440P]: "4k",
    [Resolution.FHD_1080P]: "1080p",
    [Resolution.HD_720P]: "720p",
    [Resolution.SD_480P]: "720p",
    [Resolution.SD_360P]: "720p",
};

/** Read last selected filter from localStorage, default to "all" */
function getSavedFilter(): ResolutionFilter {
    if (typeof window === "undefined") return "all";
    const saved = localStorage.getItem(RESOLUTION_FILTER_KEY);
    if (saved === "4k" || saved === "1080p" || saved === "720p" || saved === "all") return saved;
    return "all";
}

/** Strictly matches resolution tier */
function matchesResolutionFilter(source: AddonSource, filter: ResolutionFilter): boolean {
    if (filter === "all") return true;
    if (!source.resolution) return false;
    const tier = RESOLUTION_TIER[source.resolution];
    if (!tier) return false;
    return tier === filter;
}

/** Count sources matching a filter tier (including unknown-resolution sources in the count for "all") */
function countForFilter(sources: AddonSource[] | undefined, filter: ResolutionFilter): number {
    if (!sources) return 0;
    return sources.filter((s) => matchesResolutionFilter(s, filter)).length;
}

const FILTER_OPTIONS: { value: ResolutionFilter; label: string }[] = [
    { value: "4k", label: "4K" },
    { value: "1080p", label: "1080p" },
    { value: "720p", label: "720p" },
    { value: "all", label: "All" },
];

interface SourcesProps {
    imdbId: string;
    mediaType?: "movie" | "show";
    tvParams?: TvSearchParams;
    className?: string;
    mediaTitle: string;
}

interface SourcesDialogProps extends SourcesProps {
    children: React.ReactNode;
}

export function AddSourceButton({ magnet }: { magnet: string }) {
    const { client } = useAuthGuaranteed();
    const router = useRouter();
    const [status, setStatus] = useState<"added" | "cached" | "loading" | null>(null);
    const [torrentId, setTorrentId] = useState<number | string | null>(null);

    const handleAdd = async () => {
        setStatus("loading");
        try {
            const result = await client.addTorrent([magnet]);
            const sourceStatus = result[magnet];
            if (!sourceStatus.success) {
                throw new Error(sourceStatus.message);
            }
            setStatus(sourceStatus.is_cached ? "cached" : "added");
            setTorrentId(sourceStatus.id as number | string);
        } catch (error) {
            toast.error(`Failed to add source: ${error instanceof Error ? error.message : "Unknown error"}`);
            setStatus(null);
        }
    };

    const handleRemove = async () => {
        if (!torrentId) return;
        await client.removeTorrent(torrentId.toString());
        setStatus(null);
    };

    if (status === "cached") {
        return (
            <div className="flex items-center gap-1.5">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        if (torrentId) {
                            router.push(`/files?q=id:${torrentId}`);
                        }
                    }}>
                    <DownloadIcon className="size-4" />
                    View
                </Button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="group/delete hover:!bg-destructive/10"
                    onClick={() => handleRemove()}>
                    <Trash2Icon className="size-4 text-destructive/70 group-hover/delete:text-destructive" />
                </Button>
            </div>
        );
    }

    if (status === "added") {
        return (
            <div className="flex items-center gap-1.5">
                <div className="flex items-center h-8 gap-1.5 px-2.5 rounded-sm bg-primary/10 text-primary">
                    <HardDriveDownloadIcon className="size-4 animate-pulse" />
                    <span className="text-xs">Processing</span>
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="group/delete hover:!bg-destructive/10"
                    onClick={() => handleRemove()}>
                    <Trash2Icon className="size-4 text-destructive/70 group-hover/delete:text-destructive" />
                </Button>
            </div>
        );
    }

    return (
        <Button variant="outline" size="sm" onClick={() => handleAdd()} disabled={status === "loading"}>
            {status === "loading" ? (
                <>
                    <Loader2 className="size-4 animate-spin" />
                    Adding
                </>
            ) : (
                <>
                    <Plus className="size-4" />
                    Add
                </>
            )}
        </Button>
    );
}

export const SourceRow = memo(function SourceRow({
    source,
    mediaTitle,
    subtitles,
    tvParams,
    imdbId,
}: {
    source: AddonSource;
    mediaTitle: string;
    subtitles?: { url: string; lang: string; name?: string }[];
    tvParams?: TvSearchParams;
    imdbId?: string;
}) {
    // Build metadata string with editorial separators
    const metaParts: string[] = [];
    if (source.resolution) metaParts.push(source.resolution);
    if (source.quality) metaParts.push(source.quality);
    if (source.size) metaParts.push(source.size);
    metaParts.push(source.addonName);

    const handlePlay = () => {
        let title = mediaTitle;
        if (tvParams) {
            const s = String(tvParams.season).padStart(2, "0");
            const e = String(tvParams.episode).padStart(2, "0");
            title = `${mediaTitle} S${s}E${e}`;

            // Set context for navigation
            if (imdbId) {
                useStreamingStore.getState().setEpisodeContext({
                    imdbId,
                    title: mediaTitle, // Store RAW title for context
                    season: tvParams.season,
                    episode: tvParams.episode,
                });
            }
        }
        useStreamingStore.getState().playSource(source, title, { subtitles });
    };

    return (
        <div className="flex flex-col gap-2 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors">
            {/* Title */}
            <div className="text-sm leading-tight break-words">{source.title}</div>

            {/* Description */}
            {source.description && (
                <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                    {source.description}
                </div>
            )}

            {/* Metadata & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                {/* Metadata with editorial separators */}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-1 text-xs text-muted-foreground">
                    {source.isCached && (
                        <>
                            <CachedBadge />
                            <span className="text-border">·</span>
                        </>
                    )}
                    {metaParts.map((part, i) => (
                        <span key={part} className="flex items-center">
                            {part}
                            {i < metaParts.length - 1 && <span className="text-border ml-2">·</span>}
                        </span>
                    ))}
                </div>

                {/* Action Buttons */}
                {(source.url || source.magnet) && (
                    <div className="flex items-center gap-2 justify-end sm:shrink-0">
                        {source.magnet && <AddSourceButton magnet={source.magnet} />}
                        {source.url && (
                            <Button
                                size="sm"
                                onClick={handlePlay}>
                                <PlayIcon className="size-4 fill-current" />
                                Play
                            </Button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

export function Sources({ imdbId, mediaType = "movie", tvParams, className, mediaTitle }: SourcesProps) {
    const { data: sources, isLoading, failedAddons, retry } = useAddonSources({ imdbId, mediaType, tvParams });
    const { data: subtitles } = useAddonSubtitles({ imdbId, mediaType, tvParams });

    const [addonFilter, setAddonFilter] = useState("all");

    // Resolution filter — remembered independently from settings
    const [resolutionFilter, setResolutionFilterRaw] = useState<ResolutionFilter>(getSavedFilter);
    const setResolutionFilter = useCallback((value: ResolutionFilter) => {
        setResolutionFilterRaw(value);
        try { localStorage.setItem(RESOLUTION_FILTER_KEY, value); } catch { /* noop */ }
    }, []);

    const addonNames = useMemo(() => {
        if (!sources?.length) return [];
        const seen = new Map<string, string>();
        for (const s of sources) {
            if (!seen.has(s.addonId)) seen.set(s.addonId, s.addonName);
        }
        return Array.from(seen, ([id, name]) => ({ id, name }));
    }, [sources]);

    const filtered = useMemo(() => {
        let result = sources;
        if (addonFilter !== "all") {
            result = result?.filter((s) => s.addonId === addonFilter);
        }
        if (resolutionFilter !== "all") {
            result = result?.filter((s) => matchesResolutionFilter(s, resolutionFilter));
        }
        return result;
    }, [sources, addonFilter, resolutionFilter]);

    // Total unfiltered sources count (after addon filter only)
    const totalSourceCount = useMemo(() => {
        if (!sources) return 0;
        if (addonFilter !== "all") return sources.filter((s) => s.addonId === addonFilter).length;
        return sources.length;
    }, [sources, addonFilter]);

    return (
        <div className="space-y-2">
            {/* Filter bar — resolution + addon filters */}
            <div className="flex items-center justify-between gap-2 pt-2">
                {/* Resolution filter tabs */}
                <div className="flex items-center gap-0.5 bg-muted/30 rounded-sm p-0.5">
                    {FILTER_OPTIONS.map((opt) => {
                        const count = countForFilter(sources, opt.value);
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setResolutionFilter(opt.value)}
                                className={cn(
                                    "px-2.5 py-1 text-xs rounded-sm transition-colors",
                                    resolutionFilter === opt.value
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}>
                                {opt.label}
                                {!isLoading && count > 0 && opt.value !== "all" && (
                                    <span className="ml-1 opacity-60">{count}</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Addon filter + refresh — shown when multiple addons provide sources */}
                <div className="flex items-center gap-1.5">
                    {addonNames.length > 1 && (
                        <Select value={addonFilter} onValueChange={setAddonFilter}>
                            <SelectTrigger className="w-32 sm:w-40 h-8 text-xs sm:text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All addons</SelectItem>
                                {addonNames.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                        {a.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                    {process.env.NODE_ENV === "development" && (
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={retry}
                            disabled={isLoading}
                            title="Force refresh (bypass cache)">
                            <RefreshCw className={cn("size-3.5", isLoading && "animate-spin")} />
                        </Button>
                    )}
                </div>
            </div>

            <div className={cn("border border-border/50 rounded-sm overflow-hidden", className)}>
                {/* Loading indicator */}
                {isLoading && (
                    <div className="flex items-center justify-center gap-2 px-4 py-3 border-b border-border/50 bg-muted/20">
                        <Loader2 className="size-4.5 animate-spin text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Loading sources...</span>
                    </div>
                )}

                {!isLoading && filtered?.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center px-4 gap-3">
                        {totalSourceCount > 0 ? (
                            <>
                                <p className="text-sm text-muted-foreground">
                                    No {resolutionFilter === "4k" ? "4K" : resolutionFilter} sources found
                                </p>
                                <p className="text-xs text-muted-foreground/70">
                                    {totalSourceCount} source{totalSourceCount !== 1 ? "s" : ""} available in other qualities
                                </p>
                                <Button variant="outline" size="sm" onClick={() => setResolutionFilter("all")}>
                                    Show all sources
                                </Button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-muted-foreground">No sources available</p>
                                <p className="text-xs text-muted-foreground/70">Configure addons to fetch sources</p>
                                <Button variant="outline" size="sm" onClick={retry}>
                                    <RefreshCw className="size-4" />
                                    Retry
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {filtered?.map((source, index) => (
                    <SourceRow
                        key={`${source.addonId}-${source.url ?? "magnet"}-${index}`}
                        source={source}
                        mediaTitle={mediaTitle}
                        subtitles={subtitles}
                        tvParams={tvParams}
                        imdbId={imdbId}
                    />
                ))}

                {/* Failed addons warning */}
                {!isLoading && failedAddons.length > 0 && (
                    <div className="flex items-center justify-center gap-2 px-4 py-3 bg-yellow-500/10 border-t border-border/50">
                        <AlertTriangle className="size-4.5 text-yellow-600" />
                        <span className="text-xs text-yellow-600">Failed: {failedAddons.join(", ")}</span>
                        <Button variant="outline" size="sm" className="h-6 text-xs ml-1" onClick={retry}>
                            <RefreshCw className="size-3" />
                            Retry
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export function SourcesDialog({ imdbId, mediaType = "movie", tvParams, mediaTitle, children }: SourcesDialogProps) {
    if (!imdbId) return null;

    return (
        <Dialog>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col gap-0">
                <div className="flex-none px-6 pt-6 pb-4 border-b border-border/50">
                    <DialogTitle>
                        Sources
                        {tvParams && (
                            <span className="text-muted-foreground">
                                {" "}
                                · S{String(tvParams.season).padStart(2, "0")}E
                                {String(tvParams.episode).padStart(2, "0")}
                            </span>
                        )}
                    </DialogTitle>
                    <DialogDescription className="mt-2 text-xs text-muted-foreground">
                        Select a source to add to your download queue
                    </DialogDescription>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
                    <Sources
                        imdbId={imdbId}
                        mediaType={mediaType}
                        tvParams={tvParams}
                        mediaTitle={mediaTitle}
                        className="border-0"
                    />
                </div>
                <div className="flex-none px-6 py-4 border-t border-border/50 bg-muted/20">
                    <DialogClose asChild>
                        <Button variant="outline" className="w-full sm:w-auto sm:ml-auto sm:flex">
                            Close
                        </Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}
