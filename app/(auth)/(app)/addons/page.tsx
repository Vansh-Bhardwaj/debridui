"use client";

import { useState, useMemo, useCallback } from "react";
import { useUserAddons, useAddAddon, useRemoveAddon, useToggleAddon, useToggleAddonCatalogs, useUpdateAddonOrders } from "@/hooks/use-addons";
import { AddonClient } from "@/lib/addons/client";
import { type Addon } from "@/lib/addons/types";
import { type CreateAddon } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Plus, Loader2, Puzzle, Info, RefreshCw, ClipboardPaste, X, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { AddonCard, AddonCardSkeleton } from "@/components/addons/addon-card";
import { CachedBadge } from "@/components/common/display";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SectionDivider } from "@/components/common/section-divider";

const ADDON_PRESETS = [
    {
        name: "Torrentio",
        url: "https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex|qualityfilter=480p,other,scr,cam/manifest.json",
    },
    {
        name: "Streaming Catalogs",
        url: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LGRucCxhbXAsYXRwLGhibSxwbXAsamhzLHplZSxjcnUscGNwLHNvbnlsaXY6OjoxNzcwMjQ2NjcwMTU5OjA6MDo%3D/manifest.json",
    },
] as const;

const CONFIGURABLE_ADDONS = [
    {
        name: "Comet",
        description: "Fast torrent/debrid search addon with proxy streaming support",
        configureUrl: "https://comet.elfhosted.com/configure",
    },
    {
        name: "MediaFusion",
        description: "Multi-language catalogs with extensive scraper and debrid support",
        configureUrl: "https://mediafusion.elfhosted.com/configure",
    },
    {
        name: "AIOStreams",
        description: "All-in-one addon that aggregates multiple addons with advanced filtering",
        configureUrl: "https://aiostreams.elfhosted.com/stremio/configure",
    },
    {
        name: "Meteor",
        description: "High-performance scraper with strong anime matching and multi-debrid support",
        configureUrl: "https://meteorfortheweebs.midnightignite.me/configure",
    },
] as const;

export default function AddonsPage() {
    const { data: serverAddons = [], isLoading, refetch } = useUserAddons();
    const addAddonMutation = useAddAddon();
    const removeAddonMutation = useRemoveAddon();
    const toggleAddonMutation = useToggleAddon();
    const toggleCatalogsMutation = useToggleAddonCatalogs();
    const updateOrdersMutation = useUpdateAddonOrders();

    const [newAddonUrl, setNewAddonUrl] = useState("");
    const [validating, setValidating] = useState(false);
    const [addonToDelete, setAddonToDelete] = useState<Addon | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Memoize sorted addons to avoid re-sorting on every render
    const sortedAddons = useMemo(() => [...serverAddons].sort((a, b) => a.order - b.order), [serverAddons]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await refetch();
        setIsRefreshing(false);
    }, [refetch]);

    const handleAddAddon = async (url?: string) => {
        const addonUrl = url || newAddonUrl;

        if (!addonUrl.trim()) {
            toast.error("Please enter an addon URL");
            return;
        }

        setValidating(true);
        try {
            const client = new AddonClient({ url: addonUrl });
            const manifest = await client.fetchManifest();
            const normalizedUrl = client.getBaseUrl();

            // Check if addon URL already exists (compare normalized base URLs)
            const addonExists = serverAddons.some((addon: Addon) => {
                try {
                    const existing = new AddonClient({ url: addon.url });
                    return existing.getBaseUrl() === normalizedUrl;
                } catch { return false; }
            });
            if (addonExists) {
                toast.error(`${manifest.name} addon is already added`);
                setValidating(false);
                return;
            }

            const newAddon: CreateAddon = {
                name: manifest.name,
                url: normalizedUrl,
                enabled: true,
            };

            await addAddonMutation.mutateAsync(newAddon);
            toast.success(`Added ${manifest.name} addon`);
            setNewAddonUrl("");
        } catch (error) {
            toast.error(`Failed to add addon: ${error instanceof Error ? error.message : "Invalid addon URL"}`);
        } finally {
            setValidating(false);
        }
    };

    const handleRemoveAddon = (addon: Addon) => {
        setAddonToDelete(addon);
    };

    const confirmRemoveAddon = async () => {
        if (!addonToDelete) return;

        await removeAddonMutation.mutateAsync(addonToDelete.id);
        toast.success(`Removed ${addonToDelete.name} addon`);
        setAddonToDelete(null);
    };

    const handleToggleAddon = async (addon: Addon) => {
        await toggleAddonMutation.mutateAsync({ addonId: addon.id, enabled: !addon.enabled });
        toast.success(`${addon.enabled ? "Disabled" : "Enabled"} ${addon.name} addon`);
    };

    const handleToggleCatalogs = async (addon: Addon) => {
        await toggleCatalogsMutation.mutateAsync({ addonId: addon.id, showCatalogs: !addon.showCatalogs });
        toast.success(`${addon.showCatalogs ? "Hidden" : "Showing"} ${addon.name} catalogs on dashboard`);
    };

    const handleMoveUp = async (addon: Addon) => {
        const currentIndex = sortedAddons.findIndex((a) => a.id === addon.id);

        if (currentIndex > 0) {
            const updates = [
                { id: sortedAddons[currentIndex].id, order: sortedAddons[currentIndex - 1].order },
                { id: sortedAddons[currentIndex - 1].id, order: sortedAddons[currentIndex].order },
            ];
            await updateOrdersMutation.mutateAsync(updates);
        }
    };

    const handleMoveDown = async (addon: Addon) => {
        const currentIndex = sortedAddons.findIndex((a) => a.id === addon.id);

        if (currentIndex < sortedAddons.length - 1) {
            const updates = [
                { id: sortedAddons[currentIndex].id, order: sortedAddons[currentIndex + 1].order },
                { id: sortedAddons[currentIndex + 1].id, order: sortedAddons[currentIndex].order },
            ];
            await updateOrdersMutation.mutateAsync(updates);
        }
    };

    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader
                icon={Puzzle}
                title="Stremio Addons"
                description="Manage your Stremio addons to fetch sources from multiple providers"
                action={
                    <Button onClick={handleRefresh} disabled={isRefreshing || isLoading} variant="outline">
                        <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                }
            />

            {/* Add New Addon Section */}
            <section className="space-y-4">
                <SectionDivider label="Add Addon" />

                <div className="space-y-3">
                    {/* URL Input — always visible */}
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Input
                                type="url"
                                placeholder="https://addon.example.com/manifest.json"
                                value={newAddonUrl}
                                onChange={(e) => setNewAddonUrl(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && newAddonUrl.trim() && handleAddAddon()}
                                disabled={validating}
                                className="font-mono text-sm pr-9"
                            />
                            <button
                                type="button"
                                onClick={
                                    newAddonUrl
                                        ? () => setNewAddonUrl("")
                                        : async () => {
                                              try {
                                                  const text = await navigator.clipboard.readText();
                                                  if (text.trim()) setNewAddonUrl(text.trim());
                                              } catch {
                                                  toast.error("Unable to read clipboard");
                                              }
                                          }
                                }
                                disabled={validating}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                                {newAddonUrl ? <X className="size-4" /> : <ClipboardPaste className="size-4" />}
                            </button>
                        </div>
                        <Button onClick={() => handleAddAddon()} disabled={validating || !newAddonUrl.trim()}>
                            {validating && !newAddonUrl.trim() ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : validating ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    <span className="hidden sm:inline">Add</span>
                                </>
                            ) : (
                                <>
                                    <Plus className="size-4" />
                                    <span className="hidden sm:inline">Add</span>
                                </>
                            )}
                        </Button>
                    </div>

                    {/* Quick add presets */}
                    <div className="space-y-2">
                        <p className="text-xs tracking-widest uppercase text-muted-foreground">Quick add</p>
                        <div className="flex flex-wrap gap-2">
                            {ADDON_PRESETS.map((preset) => (
                                <Button
                                    key={preset.name}
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleAddAddon(preset.url)}
                                    disabled={validating}>
                                    {validating && !newAddonUrl.trim() ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <Puzzle className="size-4" />
                                    )}
                                    {preset.name}
                                </Button>
                            ))}
                        </div>
                    </div>

                    {/* Configurable addons — require setup on external page */}
                    <div className="space-y-2">
                        <p className="text-xs tracking-widest uppercase text-muted-foreground">
                            Configure &amp; Add
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            {CONFIGURABLE_ADDONS.map((addon) => (
                                <a
                                    key={addon.name}
                                    href={addon.configureUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="group flex flex-col gap-1 rounded-sm border border-border/50 px-3 py-2.5 hover:border-border hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">{addon.name}</span>
                                        <ExternalLink className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                                    </div>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        {addon.description}
                                    </p>
                                </a>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground/70">
                            Configure on the addon&apos;s page, copy the manifest URL, then paste it above
                        </p>
                    </div>
                </div>
            </section>

            {/* Addons List Section */}
            <section className="space-y-4">
                <SectionDivider label="Your Addons" />

                <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                        {isLoading
                            ? "Loading..."
                            : sortedAddons.length === 0
                                ? "No addons configured yet"
                                : `${sortedAddons.filter((a) => a.enabled).length} of ${sortedAddons.length} addon(s) enabled`}
                    </p>
                </div>

                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <AddonCardSkeleton key={i} />
                        ))}
                    </div>
                ) : sortedAddons.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <p className="text-sm font-light text-foreground">No addons added yet</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            Add your first addon to start fetching sources
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {sortedAddons.map((addon, index) => (
                            <AddonCard
                                key={addon.id}
                                addon={addon}
                                onToggle={handleToggleAddon}
                                onToggleCatalogs={handleToggleCatalogs}
                                onRemove={handleRemoveAddon}
                                onMoveUp={handleMoveUp}
                                onMoveDown={handleMoveDown}
                                isFirst={index === 0}
                                isLast={index === sortedAddons.length - 1}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* Info Section */}
            <section className="space-y-4">
                <SectionDivider label="Information" />

                <div className="rounded-sm border border-border/50 p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="space-y-2 text-xs text-muted-foreground">
                            <p>
                                Stremio addons follow a standard protocol. Sources from all enabled addons will be
                                merged and displayed together in the order listed above. Use the arrow buttons to
                                reorder addons.
                            </p>
                            <p>
                                <strong className="text-foreground">Cached sources</strong> (marked with <CachedBadge />
                                ) are detected by checking if the source name contains &quot;instant&quot; or
                                &quot;+&quot;, or if the name/description includes ✅ or ⚡️ emojis. Cached sources are
                                instantly available for download from your debrid service.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                open={!!addonToDelete}
                onOpenChange={(open) => !open && setAddonToDelete(null)}
                title="Remove Addon"
                description={`Are you sure you want to remove "${addonToDelete?.name}"? This action cannot be undone.`}
                confirmText="Remove"
                cancelText="Cancel"
                variant="destructive"
                onConfirm={confirmRemoveAddon}
            />
        </div>
    );
}
