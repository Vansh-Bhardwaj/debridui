/**
 * PlaybackQueue — shared queue across all connected devices.
 *
 * Any device can add items. The playing device auto-advances when current
 * content ends. Queue is persisted in DO SQLite (survives disconnections).
 */

"use client";

import { useEffect } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import type { QueueItem } from "@/lib/device-sync/protocol";
import { usePreviewStore } from "@/lib/stores/preview";
import { FileType } from "@/lib/types";
import { ListMusic, X, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PlaybackQueueProps {
    className?: string;
    compact?: boolean;
}

export function PlaybackQueue({ className, compact }: PlaybackQueueProps) {
    const queue = useDeviceSyncStore((s) => s.queue);
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const queueRemove = useDeviceSyncStore((s) => s.queueRemove);
    const queueClear = useDeviceSyncStore((s) => s.queueClear);
    const queueRefresh = useDeviceSyncStore((s) => s.queueRefresh);
    const transferPlayback = useDeviceSyncStore((s) => s.transferPlayback);
    const activeTarget = useDeviceSyncStore((s) => s.activeTarget);

    // Refresh queue on mount
    useEffect(() => {
        if (enabled) queueRefresh();
    }, [enabled, queueRefresh]);

    if (!enabled || queue.length === 0) return null;

    const handlePlay = (item: QueueItem) => {
        const payload = {
            url: item.url,
            title: item.title,
            imdbId: item.imdbId,
            mediaType: item.mediaType,
            season: item.season,
            episode: item.episode,
            subtitles: item.subtitles,
        };

        if (activeTarget) {
            // Send to active target
            transferPlayback(activeTarget, payload);
        } else {
            // Play locally
            usePreviewStore.getState().openSinglePreview({
                url: payload.url,
                title: payload.title,
                fileType: FileType.VIDEO,
                subtitles: payload.subtitles?.map((s) => ({
                    url: s.url,
                    lang: s.lang,
                    id: s.url,
                    name: s.name,
                })),
                progressKey: payload.imdbId
                    ? {
                          imdbId: payload.imdbId,
                          type: (payload.mediaType ?? "movie") as "movie" | "show",
                          season: payload.season,
                          episode: payload.episode,
                      }
                    : undefined,
            });
        }

        // Remove from queue after playing
        queueRemove(item.id);
    };

    return (
        <div className={cn("space-y-2", className)}>
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                    <ListMusic className="size-3.5 text-muted-foreground" />
                    <p className="text-xs tracking-widest uppercase text-muted-foreground">
                        Queue · {queue.length}
                    </p>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] text-muted-foreground hover:text-destructive gap-1"
                    onClick={queueClear}
                >
                    <Trash2 className="size-3" />
                    Clear
                </Button>
            </div>

            <div className={cn("space-y-1", compact ? "max-h-32" : "max-h-48", "overflow-y-auto")}>
                {queue.map((item, i) => (
                    <div
                        key={item.id}
                        className="flex items-center gap-2 rounded-sm px-2 py-1.5 group hover:bg-muted/30 transition-colors"
                    >
                        <span className="text-[10px] text-muted-foreground w-4 text-center shrink-0">
                            {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs truncate">{item.title}</p>
                            <p className="text-[10px] text-muted-foreground">
                                Added by {item.addedBy}
                                {item.mediaType === "show" && item.season && item.episode && (
                                    <> <span className="text-border">·</span> S{String(item.season).padStart(2, "0")}E{String(item.episode).padStart(2, "0")}</>
                                )}
                            </p>
                        </div>
                        <div className="flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => handlePlay(item)}
                                title="Play now"
                            >
                                <Play className="size-3 fill-current" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-6 text-muted-foreground hover:text-destructive"
                                onClick={() => queueRemove(item.id)}
                                title="Remove"
                            >
                                <X className="size-3" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
