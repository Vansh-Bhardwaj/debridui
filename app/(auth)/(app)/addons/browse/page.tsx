"use client";
export const dynamic = "force-static";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useUserAddons, useAddAddon } from "@/hooks/use-addons";
import { AddonClient } from "@/lib/addons/client";
import { type Addon } from "@/lib/addons/types";
import { type CreateAddon } from "@/lib/types";
import {
    ADDON_CATALOG,
    ADDON_CATALOG_CATEGORIES,
    type AddonCatalogCategory,
    type AddonCatalogEntry,
} from "@/lib/addons/catalog";
import { PageHeader } from "@/components/common/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
    ArrowLeft,
    Search,
    Puzzle,
    ExternalLink,
    Check,
    Loader2,
    Zap,
    BookOpen,
    Captions,
    Settings2,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type CategoryFilter = AddonCatalogCategory | "all";

const CATEGORY_ICONS: Record<AddonCatalogCategory, React.ComponentType<{ className?: string }>> = {
    streams: Zap,
    catalogs: BookOpen,
    subtitles: Captions,
    utility: Settings2,
};

export default function AddonCatalogBrowsePage() {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<CategoryFilter>("all");
    const [installingId, setInstallingId] = useState<string | null>(null);

    const { data: serverAddons = [] } = useUserAddons();
    const addAddonMutation = useAddAddon();

    /** Normalized set of already-installed base URLs so we can flag catalog
     *  entries that match. */
    const installedBaseUrls = useMemo(() => {
        const out = new Set<string>();
        for (const addon of serverAddons as Addon[]) {
            try {
                out.add(new AddonClient({ url: addon.url }).getBaseUrl());
            } catch { /* skip malformed entries */ }
        }
        return out;
    }, [serverAddons]);

    const isInstalled = useCallback((entry: AddonCatalogEntry) => {
        if (entry.installType !== "direct" || !entry.manifestUrl) return false;
        try {
            return installedBaseUrls.has(new AddonClient({ url: entry.manifestUrl }).getBaseUrl());
        } catch {
            return false;
        }
    }, [installedBaseUrls]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return ADDON_CATALOG.filter((entry) => {
            if (category !== "all" && entry.category !== category) return false;
            if (!q) return true;
            return (
                entry.name.toLowerCase().includes(q) ||
                entry.description.toLowerCase().includes(q) ||
                entry.category.toLowerCase().includes(q)
            );
        });
    }, [query, category]);

    const handleInstall = useCallback(async (entry: AddonCatalogEntry) => {
        if (entry.installType !== "direct" || !entry.manifestUrl) return;
        if (isInstalled(entry)) {
            toast.info(`${entry.name} is already installed`);
            return;
        }
        setInstallingId(entry.id);
        try {
            const client = new AddonClient({ url: entry.manifestUrl });
            const manifest = await client.fetchManifest();
            const payload: CreateAddon = {
                name: manifest.name,
                url: client.getBaseUrl(),
                enabled: true,
            };
            await addAddonMutation.mutateAsync(payload);
            toast.success(`Added ${manifest.name}`);
        } catch (err) {
            toast.error(
                `Failed to install ${entry.name}: ${err instanceof Error ? err.message : "Unknown error"}`
            );
        } finally {
            setInstallingId(null);
        }
    }, [addAddonMutation, isInstalled]);

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 pb-16">
            <div className="space-y-3">
                <Link
                    href="/addons"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                    <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                    <span>Back to Your Addons</span>
                </Link>
                <PageHeader
                    icon={Puzzle}
                    title="Addon Catalog"
                    description="Browse curated Stremio-compatible addons. One-click install for direct ones, configure-and-paste for the rest."
                />
            </div>

            {/* Search + category filter */}
            <div className="space-y-3">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search addons by name, description, or category..."
                        className="pl-9 pr-9"
                        aria-label="Search catalog"
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => setQuery("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 size-7 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                            aria-label="Clear search"
                        >
                            <X className="size-3.5" />
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {ADDON_CATALOG_CATEGORIES.map((c) => {
                        const active = category === c.id;
                        return (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setCategory(c.id)}
                                className={cn(
                                    "rounded-sm border px-2.5 py-1 text-xs transition-colors",
                                    active
                                        ? "border-primary/50 bg-primary/10 text-foreground"
                                        : "border-border/50 bg-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                                )}
                                aria-pressed={active}
                            >
                                {c.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Results */}
            {filtered.length === 0 ? (
                <div className="rounded-sm border border-border/50 bg-muted/20 px-4 py-10 text-center">
                    <p className="text-sm text-muted-foreground">No addons match your filters.</p>
                </div>
            ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                    {filtered.map((entry) => {
                        const Icon = CATEGORY_ICONS[entry.category];
                        const installed = isInstalled(entry);
                        const installing = installingId === entry.id;
                        return (
                            <div
                                key={entry.id}
                                className="group flex flex-col gap-3 rounded-sm border border-border/50 bg-card/30 p-4 transition-colors hover:border-border hover:bg-card/50"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-2">
                                        <div className="flex size-8 items-center justify-center rounded-sm bg-muted/40 text-muted-foreground">
                                            <Icon className="size-4" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-medium leading-tight">{entry.name}</h3>
                                            <span className="text-[10px] tracking-widest uppercase text-muted-foreground/70">
                                                {entry.category}
                                            </span>
                                        </div>
                                    </div>
                                    {installed && (
                                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                                            <Check className="size-3" />
                                            Installed
                                        </Badge>
                                    )}
                                </div>

                                <p className="text-xs text-muted-foreground leading-relaxed">
                                    {entry.description}
                                </p>

                                {entry.resources.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {entry.resources.map((r) => (
                                            <span
                                                key={r}
                                                className="rounded-sm border border-border/50 bg-muted/20 px-1.5 py-0.5 text-[10px] tracking-widest uppercase text-muted-foreground"
                                            >
                                                {r}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {entry.notes && (
                                    <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                                        {entry.notes}
                                    </p>
                                )}

                                <div className="flex-1" />

                                {entry.installType === "direct" ? (
                                    <Button
                                        size="sm"
                                        variant={installed ? "outline" : "default"}
                                        disabled={installing || installed}
                                        onClick={() => handleInstall(entry)}
                                        className="w-full justify-center"
                                    >
                                        {installing ? (
                                            <>
                                                <Loader2 className="size-4 animate-spin" />
                                                Installing...
                                            </>
                                        ) : installed ? (
                                            <>
                                                <Check className="size-4" />
                                                Installed
                                            </>
                                        ) : (
                                            <>
                                                <Puzzle className="size-4" />
                                                Install
                                            </>
                                        )}
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="outline" asChild className="w-full justify-center">
                                        <a href={entry.configureUrl} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="size-4" />
                                            Configure
                                        </a>
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="rounded-sm border border-border/50 bg-muted/10 p-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                    Configure addons open on the addon&apos;s own site. After selecting your options, copy the
                    manifest URL they give you and paste it into the &ldquo;Add addon&rdquo; input on the{" "}
                    <Link href="/addons" className="text-foreground underline underline-offset-2">Your Addons</Link>{" "}
                    page.
                </p>
            </div>
        </div>
    );
}
