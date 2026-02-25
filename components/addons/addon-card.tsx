"use client";

import { type Addon } from "@/lib/addons/types";
import { useAddon } from "@/hooks/use-addons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import { Puzzle, Trash2, Share2, ArrowUp, ArrowDown, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { addonSupportsCatalogs } from "@/lib/addons/types";

interface AddonCardProps {
    addon: Addon;
    onToggle: (addon: Addon) => void;
    onToggleCatalogs: (addon: Addon) => void;
    onRemove: (addon: Addon) => void;
    onMoveUp?: (addon: Addon) => void;
    onMoveDown?: (addon: Addon) => void;
    isFirst?: boolean;
    isLast?: boolean;
}

export function AddonCardSkeleton() {
    return (
        <div className="rounded-sm border border-border/50 p-4 space-y-3">
            {/* Row 1: Icon + Name/Version */}
            <div className="flex gap-3 items-start">
                <Skeleton className="h-10 w-10 rounded-sm shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-16" />
                </div>
            </div>

            {/* Row 2: Description */}
            <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
            </div>

            {/* Row 3: Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/50">
                <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-9 rounded-full" />
                    <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center gap-1">
                    <Skeleton className="h-9 w-9 rounded-sm" />
                    <Skeleton className="h-9 w-9 rounded-sm" />
                    <Skeleton className="h-9 w-9 rounded-sm" />
                    <Skeleton className="h-9 w-9 rounded-sm" />
                </div>
            </div>
        </div>
    );
}

export function AddonCard({ addon, onToggle, onToggleCatalogs, onRemove, onMoveUp, onMoveDown, isFirst, isLast }: AddonCardProps) {
    const { data: manifest, isLoading } = useAddon({ addonId: addon.id, url: addon.url });
    const hasCatalogs = !!manifest && addonSupportsCatalogs(manifest);

    return (
        <div
            className={cn(
                "rounded-sm border border-border/50 p-4 transition-all duration-300 space-y-3",
                addon.enabled ? "bg-card" : "bg-muted/30 opacity-75"
            )}>
            {/* Row 1: Icon + Name/Version */}
            <div className="flex gap-3 items-start">
                {/* Column 1: Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-muted/50 overflow-hidden relative">
                    {isLoading ? (
                        <Skeleton className="h-full w-full" />
                    ) : manifest?.logo ? (
                        <Image fill src={manifest.logo} alt={addon.name} sizes="40px" unoptimized className="object-contain p-1" />
                    ) : (
                        <Puzzle className="size-5 text-muted-foreground" />
                    )}
                </div>

                {/* Column 2: Name + Version */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-light text-base truncate">{addon.name}</h3>
                    {isLoading ? (
                        <Skeleton className="h-3 w-12 mt-1" />
                    ) : (
                        manifest?.version && (
                            <span className="text-xs tracking-wide text-muted-foreground">v{manifest.version}</span>
                        )
                    )}
                </div>
            </div>

            {/* Row 2: Description */}
            {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                </div>
            ) : (
                manifest?.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">
                        {manifest.description}
                    </p>
                )
            )}

            {/* Row 3: Actions */}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-border/50 flex-wrap">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Switch id={`toggle-${addon.id}`} checked={addon.enabled} onCheckedChange={() => onToggle(addon)} data-tv-focusable tabIndex={0} />
                        <Label
                            htmlFor={`toggle-${addon.id}`}
                            className="text-xs cursor-pointer whitespace-nowrap text-muted-foreground">
                            {addon.enabled ? "Enabled" : "Disabled"}
                        </Label>
                    </div>
                    {hasCatalogs && (
                        <div className="flex items-center gap-2">
                            <Switch
                                id={`catalogs-${addon.id}`}
                                checked={addon.showCatalogs}
                                onCheckedChange={() => onToggleCatalogs(addon)}
                                disabled={!addon.enabled}
                                data-tv-focusable
                                tabIndex={0}
                            />
                            <Label
                                htmlFor={`catalogs-${addon.id}`}
                                className={cn(
                                    "text-xs cursor-pointer whitespace-nowrap flex items-center gap-1",
                                    addon.enabled ? "text-muted-foreground" : "text-muted-foreground/50"
                                )}>
                                <LayoutGrid className="size-3" />
                                Catalogs
                            </Label>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {onMoveUp && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onMoveUp(addon)}
                            disabled={isFirst}
                            aria-label={`Move ${addon.name} up`}
                            title="Move up"
                            data-tv-focusable
                            tabIndex={0}>
                            <ArrowUp className="size-4" />
                        </Button>
                    )}
                    {onMoveDown && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onMoveDown(addon)}
                            disabled={isLast}
                            aria-label={`Move ${addon.name} down`}
                            title="Move down"
                            data-tv-focusable
                            tabIndex={0}>
                            <ArrowDown className="size-4" />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                            navigator.clipboard.writeText(addon.url);
                            toast.success("Addon URL copied to clipboard");
                        }}
                        aria-label={`Copy ${addon.name} URL`}
                        title="Copy addon URL"
                        data-tv-focusable
                        tabIndex={0}>
                        <Share2 className="size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRemove(addon)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${addon.name}`}
                        title="Remove addon"
                        data-tv-focusable
                        tabIndex={0}>
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
