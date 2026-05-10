"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useStreamingStore } from "@/lib/stores/streaming";
import { type AddonSource, Resolution } from "@/lib/addons/types";
import { Zap, HardDrive, Check, ArrowDownUp, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

type ResolutionFilter = "all" | "2160p" | "1080p" | "720p" | "sd";
type SortMode = "default" | "resolution" | "size" | "addon";

const RESOLUTION_ORDER: Resolution[] = [
    Resolution.UHD_4K,
    Resolution.QHD_1440P,
    Resolution.FHD_1080P,
    Resolution.HD_720P,
    Resolution.SD_480P,
    Resolution.SD_360P,
];

function resolutionRank(res?: Resolution): number {
    if (!res) return RESOLUTION_ORDER.length;
    const idx = RESOLUTION_ORDER.indexOf(res);
    return idx === -1 ? RESOLUTION_ORDER.length : idx;
}

function matchesResolutionFilter(source: AddonSource, filter: ResolutionFilter): boolean {
    if (filter === "all") return true;
    const res = source.resolution;
    if (filter === "2160p") return res === Resolution.UHD_4K;
    if (filter === "1080p") return res === Resolution.FHD_1080P || res === Resolution.QHD_1440P;
    if (filter === "720p") return res === Resolution.HD_720P;
    if (filter === "sd") return res === Resolution.SD_480P || res === Resolution.SD_360P || !res;
    return true;
}

/** Parse size strings like "2.3 GB" / "800 MB" into bytes; returns NaN for unknown. */
function parseSizeBytes(size?: string): number {
    if (!size) return NaN;
    const m = size.match(/([\d.]+)\s*(GB|MB|KB|TB)/i);
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    const unit = m[2]!.toUpperCase();
    const multiplier = unit === "TB" ? 1024 ** 4 : unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
    return n * multiplier;
}

const SourceItem = memo(function SourceItem({
    source,
    isSelected,
    onSelect,
    numberKey,
}: {
    source: AddonSource;
    isSelected: boolean;
    onSelect: (s: AddonSource) => void;
    numberKey?: number;
}) {
    return (
        <button
            onClick={() => onSelect(source)}
            className={cn(
                "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/50 last:border-0",
                isSelected
                    ? "bg-primary/5 text-foreground"
                    : "hover:bg-muted/30 text-foreground/80"
            )}
        >
            <div className={cn(
                "shrink-0 flex size-8 items-center justify-center rounded-sm relative",
                source.isCached ? "bg-emerald-500/10 text-emerald-500" : "bg-muted/50 text-muted-foreground"
            )}>
                {source.isCached ? <Zap className="size-4" /> : <HardDrive className="size-4" />}
                {numberKey != null && (
                    <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-background border border-border/70 text-[9px] font-mono text-muted-foreground">
                        {numberKey}
                    </span>
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    {source.resolution && (
                        <span className="text-xs font-mono font-medium">{source.resolution}</span>
                    )}
                    {source.quality && (
                        <span className="text-xs text-muted-foreground">{source.quality}</span>
                    )}
                    {source.isCached && (
                        <span className="text-[10px] tracking-widest uppercase text-emerald-500">Cached</span>
                    )}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    {source.size && <span>{source.size}</span>}
                    {source.size && source.addonName && <span className="text-border">·</span>}
                    <span className="truncate">{source.addonName}</span>
                </div>
            </div>

            {isSelected && <Check className="size-4 text-primary shrink-0" />}
        </button>
    );
});

const RESOLUTION_FILTERS: Array<{ id: ResolutionFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "2160p", label: "4K" },
    { id: "1080p", label: "1080p" },
    { id: "720p", label: "720p" },
    { id: "sd", label: "SD" },
];

const SORT_MODES: Array<{ id: SortMode; label: string }> = [
    { id: "default", label: "Default" },
    { id: "resolution", label: "Resolution" },
    { id: "size", label: "Size" },
    { id: "addon", label: "Addon" },
];

export const SourcePickerSheet = memo(function SourcePickerSheet() {
    const sourcePickerOpen = useStreamingStore((s) => s.sourcePickerOpen);
    const closeSourcePicker = useStreamingStore((s) => s.closeSourcePicker);
    const allFetchedSources = useStreamingStore((s) => s.allFetchedSources);
    const selectedSource = useStreamingStore((s) => s.selectedSource);
    const playAlternativeSource = useStreamingStore((s) => s.playAlternativeSource);
    const pendingPlayContext = useStreamingStore((s) => s.pendingPlayContext);

    const [resFilter, setResFilter] = useState<ResolutionFilter>("all");
    const [cachedOnly, setCachedOnly] = useState(false);
    const [sort, setSort] = useState<SortMode>("default");

    // Reset filters when the sheet closes so the next open starts fresh.
    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) {
                setResFilter("all");
                setCachedOnly(false);
                setSort("default");
                closeSourcePicker();
            }
        },
        [closeSourcePicker],
    );

    const handleSelect = useCallback((source: AddonSource) => {
        playAlternativeSource(source);
    }, [playAlternativeSource]);

    const filtered = useMemo(() => {
        return allFetchedSources.filter((s) => {
            if (cachedOnly && !s.isCached) return false;
            if (!matchesResolutionFilter(s, resFilter)) return false;
            return true;
        });
    }, [allFetchedSources, cachedOnly, resFilter]);

    const sorted = useMemo(() => {
        if (sort === "default") return filtered;
        const arr = [...filtered];
        if (sort === "resolution") {
            arr.sort((a, b) => resolutionRank(a.resolution) - resolutionRank(b.resolution));
        } else if (sort === "size") {
            arr.sort((a, b) => {
                const bsize = parseSizeBytes(b.size);
                const asize = parseSizeBytes(a.size);
                if (!Number.isFinite(bsize) && !Number.isFinite(asize)) return 0;
                if (!Number.isFinite(bsize)) return -1;
                if (!Number.isFinite(asize)) return 1;
                return bsize - asize;
            });
        } else if (sort === "addon") {
            arr.sort((a, b) => (a.addonName || "").localeCompare(b.addonName || ""));
        }
        return arr;
    }, [filtered, sort]);

    const groupedDefault = sort === "default";
    const cached = useMemo(
        () => (groupedDefault ? filtered.filter((s) => s.isCached) : []),
        [groupedDefault, filtered],
    );
    const uncached = useMemo(
        () => (groupedDefault ? filtered.filter((s) => !s.isCached) : []),
        [groupedDefault, filtered],
    );

    // Stable 1..9 quick-pick order over the currently visible list.
    const quickPickOrder: AddonSource[] = useMemo(() => {
        const base = groupedDefault ? [...cached, ...uncached] : sorted;
        return base.slice(0, 9);
    }, [groupedDefault, cached, uncached, sorted]);

    useEffect(() => {
        if (!sourcePickerOpen) return;
        const handler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const n = parseInt(e.key, 10);
            if (!Number.isNaN(n) && n >= 1 && n <= 9) {
                const source = quickPickOrder[n - 1];
                if (source) {
                    e.preventDefault();
                    handleSelect(source);
                }
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [sourcePickerOpen, quickPickOrder, handleSelect]);

    const cachedCount = allFetchedSources.filter((s) => s.isCached).length;

    return (
        <Sheet open={sourcePickerOpen} onOpenChange={handleOpenChange}>
            <SheetContent side="bottom" className="max-h-[80vh] p-0 flex flex-col">
                <SheetHeader className="px-4 py-3 border-b border-border/50 shrink-0 space-y-3">
                    <div>
                        <SheetTitle className="text-base font-light">
                            {pendingPlayContext?.displayTitle ?? "Choose Source"}
                        </SheetTitle>
                        <p className="text-xs text-muted-foreground">
                            {filtered.length} of {allFetchedSources.length} source{allFetchedSources.length !== 1 ? "s" : ""}
                            {cachedCount > 0 && ` · ${cachedCount} cached`}
                        </p>
                    </div>

                    {/* Filter + sort controls */}
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[10px] tracking-widest uppercase text-muted-foreground pr-1">
                            <Filter className="size-3" /> Filter
                        </span>
                        {RESOLUTION_FILTERS.map((f) => (
                            <button
                                key={f.id}
                                onClick={() => setResFilter(f.id)}
                                className={cn(
                                    "rounded-sm border px-2 py-0.5 text-[11px] transition-colors",
                                    resFilter === f.id
                                        ? "border-primary/50 bg-primary/10 text-foreground"
                                        : "border-border/50 bg-transparent text-muted-foreground hover:bg-muted/30"
                                )}
                                aria-pressed={resFilter === f.id}
                            >
                                {f.label}
                            </button>
                        ))}
                        <button
                            onClick={() => setCachedOnly((v) => !v)}
                            className={cn(
                                "rounded-sm border px-2 py-0.5 text-[11px] transition-colors",
                                cachedOnly
                                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
                                    : "border-border/50 bg-transparent text-muted-foreground hover:bg-muted/30"
                            )}
                            aria-pressed={cachedOnly}
                        >
                            <Zap className="inline size-3 -mt-0.5 mr-0.5" /> Cached
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 text-[10px] tracking-widest uppercase text-muted-foreground pr-1">
                            <ArrowDownUp className="size-3" /> Sort
                        </span>
                        {SORT_MODES.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSort(s.id)}
                                className={cn(
                                    "rounded-sm border px-2 py-0.5 text-[11px] transition-colors",
                                    sort === s.id
                                        ? "border-primary/50 bg-primary/10 text-foreground"
                                        : "border-border/50 bg-transparent text-muted-foreground hover:bg-muted/30"
                                )}
                                aria-pressed={sort === s.id}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                            <p className="text-sm text-muted-foreground">No sources match your filters.</p>
                            <button
                                onClick={() => { setResFilter("all"); setCachedOnly(false); }}
                                className="text-xs text-primary hover:underline"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : groupedDefault ? (
                        <>
                            {cached.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground bg-muted/20 sticky top-0">
                                        Cached
                                    </div>
                                    {cached.map((source, i) => {
                                        const quickIndex = quickPickOrder.indexOf(source);
                                        return (
                                            <SourceItem
                                                key={source.url || `cached-${i}`}
                                                source={source}
                                                isSelected={source.url === selectedSource?.url}
                                                onSelect={handleSelect}
                                                numberKey={quickIndex >= 0 && quickIndex < 9 ? quickIndex + 1 : undefined}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                            {uncached.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground bg-muted/20 sticky top-0">
                                        Not Cached
                                    </div>
                                    {uncached.map((source, i) => {
                                        const quickIndex = quickPickOrder.indexOf(source);
                                        return (
                                            <SourceItem
                                                key={source.url || `uncached-${i}`}
                                                source={source}
                                                isSelected={source.url === selectedSource?.url}
                                                onSelect={handleSelect}
                                                numberKey={quickIndex >= 0 && quickIndex < 9 ? quickIndex + 1 : undefined}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    ) : (
                        sorted.map((source, i) => {
                            const quickIndex = quickPickOrder.indexOf(source);
                            return (
                                <SourceItem
                                    key={source.url || `sorted-${i}`}
                                    source={source}
                                    isSelected={source.url === selectedSource?.url}
                                    onSelect={handleSelect}
                                    numberKey={quickIndex >= 0 && quickIndex < 9 ? quickIndex + 1 : undefined}
                                />
                            );
                        })
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
});
