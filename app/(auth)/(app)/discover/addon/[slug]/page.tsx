"use client";

import { use } from "react";
import { memo, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, Film, Tv, AlertCircle, Loader2 } from "lucide-react";
import { parseCatalogSlug, useAddonCatalogDef, useAddonCatalog } from "@/hooks/use-addons";
import { MediaCard } from "@/components/mdb/media-card";

const ViewAllPage = memo(function ViewAllPage({ slug }: { slug: string }) {
    const parsed = useMemo(() => parseCatalogSlug(slug), [slug]);

    const { data: catalog, isLoading: defLoading } = useAddonCatalogDef(
        parsed?.addonId ?? "",
        parsed?.type ?? "",
        parsed?.catalogId ?? ""
    );

    const { data: items, isLoading: itemsLoading, error } = useAddonCatalog(catalog, !!catalog);

    const Icon = catalog?.type === "movie" ? Film : Tv;

    if (!parsed) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
                <AlertCircle className="size-8" />
                <p className="text-sm">Invalid catalog link.</p>
                <Link href="/dashboard" className="text-xs underline underline-offset-4 hover:text-foreground">
                    Back to Discover
                </Link>
            </div>
        );
    }

    if (defLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!catalog) {
        return (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-muted-foreground">
                <AlertCircle className="size-8" />
                <p className="text-sm">Catalog not found. The addon may have been removed.</p>
                <Link href="/dashboard" className="text-xs underline underline-offset-4 hover:text-foreground">
                    Back to Discover
                </Link>
            </div>
        );
    }

    return (
        <div className="space-y-8 py-6 lg:px-6">
            {/* Header */}
            <div className="space-y-3">
                <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
                >
                    <ArrowLeft className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
                    <span>Back to Discover</span>
                </Link>

                <div className="flex items-center gap-3">
                    <Icon className="size-5 text-muted-foreground" />
                    <div>
                        <h1 className="text-2xl font-light tracking-tight">{catalog.name}</h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {catalog.addonName} &middot; {catalog.type === "movie" ? "Movies" : "TV Shows"}
                        </p>
                    </div>
                </div>
            </div>

            {/* Content */}
            {error ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
                    <AlertCircle className="size-4" />
                    <span>Failed to load catalog content.</span>
                </div>
            ) : itemsLoading ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                    {Array.from({ length: 21 }, (_, i) => (
                        <div key={i} className="aspect-2/3 bg-muted/30 rounded-sm animate-pulse" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                    {items?.map((item, index) => {
                        const media = item.movie || item.show;
                        const type = item.movie ? "movie" : "show";
                        if (!media) return null;
                        return (
                            <div
                                key={`${type}-${media.ids?.slug || index}`}
                                className="animate-in fade-in-0 slide-in-from-bottom-2"
                                style={{
                                    animationDelay: `${Math.min(index * 20, 400)}ms`,
                                    animationDuration: "400ms",
                                    animationFillMode: "backwards",
                                }}
                            >
                                <MediaCard media={media} type={type} />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

export default function Page({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = use(params);
    return <ViewAllPage slug={slug} />;
}
