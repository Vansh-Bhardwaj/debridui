"use client";

import { memo, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useStreamingStore } from "@/lib/stores/streaming";
import { type AddonSource } from "@/lib/addons/types";
import { Zap, HardDrive, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const SourceItem = memo(function SourceItem({
    source,
    isSelected,
    onSelect,
}: {
    source: AddonSource;
    isSelected: boolean;
    onSelect: (s: AddonSource) => void;
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
            {/* Cache indicator */}
            <div className={cn(
                "shrink-0 flex size-8 items-center justify-center rounded-sm",
                source.isCached ? "bg-emerald-500/10 text-emerald-500" : "bg-muted/50 text-muted-foreground"
            )}>
                {source.isCached ? <Zap className="size-4" /> : <HardDrive className="size-4" />}
            </div>

            {/* Info */}
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

            {/* Selected check */}
            {isSelected && <Check className="size-4 text-primary shrink-0" />}
        </button>
    );
});

export const SourcePickerSheet = memo(function SourcePickerSheet() {
    const sourcePickerOpen = useStreamingStore((s) => s.sourcePickerOpen);
    const closeSourcePicker = useStreamingStore((s) => s.closeSourcePicker);
    const allFetchedSources = useStreamingStore((s) => s.allFetchedSources);
    const selectedSource = useStreamingStore((s) => s.selectedSource);
    const playAlternativeSource = useStreamingStore((s) => s.playAlternativeSource);
    const pendingPlayContext = useStreamingStore((s) => s.pendingPlayContext);

    const handleSelect = useCallback((source: AddonSource) => {
        playAlternativeSource(source);
    }, [playAlternativeSource]);

    const cached = allFetchedSources.filter((s) => s.isCached);
    const uncached = allFetchedSources.filter((s) => !s.isCached);

    return (
        <Sheet open={sourcePickerOpen} onOpenChange={closeSourcePicker}>
            <SheetContent side="bottom" className="max-h-[75vh] p-0 flex flex-col">
                <SheetHeader className="px-4 py-3 border-b border-border/50 shrink-0">
                    <SheetTitle className="text-base font-light">
                        {pendingPlayContext?.displayTitle ?? "Choose Source"}
                    </SheetTitle>
                    <p className="text-xs text-muted-foreground">
                        {allFetchedSources.length} source{allFetchedSources.length !== 1 ? "s" : ""} available
                        {cached.length > 0 && ` · ${cached.length} cached`}
                    </p>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto">
                    {cached.length > 0 && (
                        <div>
                            <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground bg-muted/20 sticky top-0">
                                Cached
                            </div>
                            {cached.map((source, i) => (
                                <SourceItem
                                    key={source.url || `cached-${i}`}
                                    source={source}
                                    isSelected={source.url === selectedSource?.url}
                                    onSelect={handleSelect}
                                />
                            ))}
                        </div>
                    )}
                    {uncached.length > 0 && (
                        <div>
                            <div className="px-4 py-2 text-[10px] tracking-widest uppercase text-muted-foreground bg-muted/20 sticky top-0">
                                Not Cached
                            </div>
                            {uncached.map((source, i) => (
                                <SourceItem
                                    key={source.url || `uncached-${i}`}
                                    source={source}
                                    isSelected={source.url === selectedSource?.url}
                                    onSelect={handleSelect}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
});
