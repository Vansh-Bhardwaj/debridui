"use client";
export const dynamic = "force-static";

import { useState, useCallback, useRef, useEffect, memo } from "react";
import { Compass, Film, Tv, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaCard } from "@/components/mdb/media-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type TraktMediaItem, type TraktMedia, traktClient } from "@/lib/trakt";
import { TMDBClient, type TMDBMovieSummary, type TMDBTVSummary } from "@/lib/tmdb";
import { useSettingsStore } from "@/lib/stores/settings";
import {
    GENRES,
    COUNTRIES,
    CINEMETA_BASE,
    type Genre,
    type Country,
} from "@/lib/discover-data";

// ── Converters ───────────────────────────────────────────────────

const TMDB_IMG = "https://image.tmdb.org/t/p";

function createSlug(title: string, year: number | string, tmdbId: number) {
    const cleanTitle = (title || "")
        .toLowerCase()
        .replace(/['"]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${cleanTitle}-${year || 0}-tmdb-${tmdbId}`;
}

function tmdbMovieToItem(m: TMDBMovieSummary): TraktMediaItem {
    const year = m.release_date ? parseInt(m.release_date.slice(0, 4), 10) || 0 : 0;
    const media: TraktMedia = {
        title: m.title,
        year,
        ids: { trakt: 0, slug: createSlug(m.title, year, m.id), tmdb: m.id },
        images: {
            poster: m.poster_path ? [`${TMDB_IMG}/w500${m.poster_path}`] : [],
            fanart: m.backdrop_path ? [`${TMDB_IMG}/w1280${m.backdrop_path}`] : [],
            logo: [], clearart: [], banner: [], thumb: [], headshot: [], screenshot: [],
        },
        rating: m.vote_average, votes: m.vote_count,
    };
    return { movie: media };
}

function tmdbTVToItem(m: TMDBTVSummary): TraktMediaItem {
    const year = m.first_air_date ? parseInt(m.first_air_date.slice(0, 4), 10) || 0 : 0;
    const media: TraktMedia = {
        title: m.name,
        year,
        ids: { trakt: 0, slug: createSlug(m.name, year, m.id), tmdb: m.id },
        images: {
            poster: m.poster_path ? [`${TMDB_IMG}/w500${m.poster_path}`] : [],
            fanart: m.backdrop_path ? [`${TMDB_IMG}/w1280${m.backdrop_path}`] : [],
            logo: [], clearart: [], banner: [], thumb: [], headshot: [], screenshot: [],
        },
        rating: m.vote_average, votes: m.vote_count,
    };
    return { show: media };
}

// ── Cinemeta fetch ───────────────────────────────────────────────

interface CinemetaResponse {
    metas?: {
        id: string; name: string; year?: string; poster?: string;
        background?: string; imdbRating?: string; genres?: string[];
    }[];
}

function cinemetaToItem(
    m: NonNullable<CinemetaResponse["metas"]>[number],
    type: "movie" | "show"
): TraktMediaItem {
    const media: TraktMedia = {
        title: m.name,
        year: m.year ? parseInt(m.year, 10) || 0 : 0,
        ids: { trakt: 0, slug: m.id, tmdb: 0, imdb: m.id.startsWith("tt") ? m.id : undefined },
        images: {
            poster: m.poster ? [m.poster] : [],
            fanart: m.background ? [m.background] : [],
            logo: [], clearart: [], banner: [], thumb: [], headshot: [], screenshot: [],
        },
        rating: m.imdbRating ? parseFloat(m.imdbRating) || undefined : undefined,
        genres: m.genres?.map((g) => g.toLowerCase()),
    };
    return type === "movie" ? { movie: media } : { show: media };
}

// Each Cinemeta "page" is a skip offset (0, 100, 200, ...)
async function fetchCinemetaPage(
    type: "movie" | "series",
    genre: string,
    skip: number
): Promise<TraktMediaItem[]> {
    const extra = skip > 0
        ? `genre=${encodeURIComponent(genre)}&skip=${skip}`
        : `genre=${encodeURIComponent(genre)}`;
    try {
        const res = await fetch(`${CINEMETA_BASE}/catalog/${type}/imdbRating/${extra}.json`, {
            signal: AbortSignal.timeout(12_000),
        });
        if (!res.ok) return [];
        const data: CinemetaResponse = await res.json();
        if (!data.metas?.length) return [];
        const itemType = type === "movie" ? "movie" as const : "show" as const;
        return data.metas.map((m) => cinemetaToItem(m, itemType));
    } catch { return []; }
}

// ── TMDB discover fetch (one page at a time) ─────────────────────

async function fetchTMDBPage(
    apiKey: string,
    mediaType: "movie" | "tv",
    genreId: number | null,
    countryCode: string | null,
    page: number
): Promise<{ items: TraktMediaItem[]; totalPages: number }> {
    const client = new TMDBClient({ apiKey });
    const params: Record<string, string | number> = {
        "vote_count.gte": 20,
        include_adult: "false",
        language: "en-US",
        page,
    };
    if (genreId) params.with_genres = String(genreId);
    if (countryCode) params.with_origin_country = countryCode;

    try {
        if (mediaType === "movie") {
            const res = await client.discoverMovies(params);
            const baseItems = res.results.map(tmdbMovieToItem);
            
            // Enrich with real Trakt slugs concurrently
            const items = await Promise.all(baseItems.map(async (item) => {
                const tmdbId = item.movie?.ids?.tmdb;
                if (!tmdbId) return item;
                try {
                    const searchRes = await traktClient.searchByTmdbId(tmdbId, "movie");
                    const hit = searchRes[0]?.movie;
                    if (hit?.ids?.slug) {
                        return { 
                            movie: { 
                                ...item.movie!, 
                                ids: { ...item.movie!.ids, slug: hit.ids.slug, trakt: hit.ids.trakt || 0, tmdb: tmdbId } 
                            } 
                        } as TraktMediaItem;
                    }
                } catch { /* keep pseudo-slug on failure */ }
                return item;
            }));
            
            return { items, totalPages: Math.min(res.total_pages, 500) };
        }
        
        const res = await client.discoverTV(params);
        const baseItems = res.results.map(tmdbTVToItem);
        
        // Enrich with real Trakt slugs concurrently
        const items = await Promise.all(baseItems.map(async (item) => {
            const tmdbId = item.show?.ids?.tmdb;
            if (!tmdbId) return item;
            try {
                const searchRes = await traktClient.searchByTmdbId(tmdbId, "show");
                const hit = searchRes[0]?.show;
                if (hit?.ids?.slug) {
                    return { 
                        show: { 
                            ...item.show!, 
                            ids: { ...item.show!.ids, slug: hit.ids.slug, trakt: hit.ids.trakt || 0, tmdb: tmdbId } 
                        } 
                    } as TraktMediaItem;
                }
            } catch { /* keep pseudo-slug on failure */ }
            return item;
        }));
            
        return { items, totalPages: Math.min(res.total_pages, 500) };
    } catch {
        return { items: [], totalPages: 0 };
    }
}

// ── Infinite query hooks ─────────────────────────────────────────

type PageData = { items: TraktMediaItem[]; nextPage: number | null };

function useBrowseInfinite(
    section: "movie" | "series",
    genre: Genre | null,
    country: Country | null,
    tmdbKey: string
) {
    const hasGenre = !!genre;
    const hasCountry = !!country;
    const hasTmdb = !!tmdbKey;
    const hasFilter = hasGenre || hasCountry;

    const useTmdb = hasTmdb && hasFilter;
    const useCinemeta = hasGenre && !hasCountry && !hasTmdb;

    const genreLabel = genre?.label ?? "";
    const genreId = section === "movie" ? (genre?.tmdbMovie ?? 0) : (genre?.tmdbTV ?? 0);
    const countryId = country?.id ?? "";
    const tmdbType = section === "movie" ? "movie" as const : "tv" as const;

    return useInfiniteQuery<PageData>({
        queryKey: ["browse-inf", section, genreLabel, countryId, useTmdb ? "tmdb" : "cinemeta"],
        queryFn: async ({ pageParam }): Promise<PageData> => {
            const page = pageParam as number;

            if (useTmdb) {
                const { items, totalPages } = await fetchTMDBPage(
                    tmdbKey, tmdbType, genreId || null, countryId || null, page
                );
                return { items, nextPage: page < totalPages ? page + 1 : null };
            }

            if (useCinemeta) {
                const skip = (page - 1) * 100;
                const items = await fetchCinemetaPage(section, genreLabel, skip);
                // Cinemeta returns empty when exhausted
                return { items, nextPage: items.length > 0 ? page + 1 : null };
            }

            return { items: [], nextPage: null };
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage) => lastPage.nextPage,
        enabled: hasFilter,
        staleTime: 10 * 60 * 1000,
    });
}

// ── Infinite Grid ────────────────────────────────────────────────

const BrowseGrid = memo(function BrowseGrid({
    items,
    type,
    isLoading,
    hasMore,
    isFetchingMore,
    onLoadMore,
}: {
    items: TraktMediaItem[];
    type: "movie" | "show";
    isLoading: boolean;
    hasMore: boolean;
    isFetchingMore: boolean;
    onLoadMore: () => void;
}) {
    const sentinelRef = useRef<HTMLDivElement>(null);

    // Intersection observer for auto-loading
    useEffect(() => {
        if (!hasMore || isFetchingMore || isLoading) return;
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) onLoadMore(); },
            { rootMargin: "400px" }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, isFetchingMore, isLoading, onLoadMore]);

    if (isLoading) {
        return (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-4 gap-3 px-4 lg:px-6 pt-2">
                {Array.from({ length: 20 }, (_, i) => (
                    <div key={i} className="animate-pulse" style={{ animationDelay: `${i * 40}ms` }}>
                        <Skeleton className="aspect-[2/3] rounded-sm" />
                    </div>
                ))}
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <p className="text-sm text-muted-foreground py-8 px-4 lg:px-6">
                No content found for this combination.
            </p>
        );
    }

    return (
        <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-4 gap-3 px-4 lg:px-6 pt-2">
                {items.map((item, index) => {
                    const media = item.movie || item.show;
                    if (!media) return null;
                    return (
                        <div
                            key={`${type}-${media.ids?.imdb || media.ids?.tmdb || index}`}
                            className="animate-in fade-in-0 motion-reduce:animate-none"
                            style={{
                                animationDelay: `${Math.min(index * 15, 200)}ms`,
                                animationDuration: "300ms",
                                animationFillMode: "backwards",
                            }}
                        >
                            <MediaCard media={media} type={type} />
                        </div>
                    );
                })}
            </div>

            {/* Sentinel + loading indicator */}
            <div ref={sentinelRef} className="flex justify-center py-6">
                {isFetchingMore && (
                    <Loader2 className="size-5 text-muted-foreground animate-spin" />
                )}
            </div>
        </>
    );
});

// ── Filter Pill ──────────────────────────────────────────────────

function FilterPill({
    label, active, hue, onClick,
}: {
    label: string; active: boolean; hue: number; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "shrink-0 h-8 px-3.5 rounded-sm text-xs font-medium transition-all duration-200",
                "border select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active
                    ? "border-transparent text-white"
                    : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
            )}
            style={active ? { backgroundColor: `hsl(${hue} 55% 45%)` } : undefined}
        >
            {label}
        </button>
    );
}

// ── Page ─────────────────────────────────────────────────────────

export default function BrowsePage() {
    const [genre, setGenre] = useState<Genre | null>(null);
    const [country, setCountry] = useState<Country | null>(null);
    const tmdbKey = useSettingsStore((s) => s.settings.tmdbApiKey);

    const movies = useBrowseInfinite("movie", genre, country, tmdbKey);
    const series = useBrowseInfinite("series", genre, country, tmdbKey);

    const movieItems = movies.data?.pages.flatMap((p) => p.items) ?? [];
    const seriesItems = series.data?.pages.flatMap((p) => p.items) ?? [];

    const toggleGenre = useCallback((g: Genre) => {
        setGenre((prev) => (prev?.id === g.id ? null : g));
    }, []);

    const toggleCountry = useCallback((c: Country) => {
        setCountry((prev) => (prev?.id === c.id ? null : c));
    }, []);

    const clear = useCallback(() => { setGenre(null); setCountry(null); }, []);

    const hue = genre?.hue ?? country?.hue ?? null;
    const hasFilter = genre || country;
    const needsKey = country && !tmdbKey;
    const label = [genre?.label, country ? `${country.flag} ${country.label}` : null].filter(Boolean).join(" · ") || null;

    return (
        <div
            className="relative min-h-dvh transition-colors duration-500"
            style={{ backgroundColor: hue !== null ? `hsl(${hue} 40% 50% / 0.04)` : undefined }}
        >
            {/* Accent */}
            <div
                className="absolute top-0 inset-x-0 h-px transition-all duration-500"
                style={{
                    backgroundColor: hue !== null ? `hsl(${hue} 55% 45%)` : "transparent",
                    opacity: hue !== null ? 0.6 : 0,
                }}
            />

            {/* ── Filters ──────────────────────────────────────────── */}
            <div className="sticky top-0 z-30 border-b border-border/50 bg-background/95 backdrop-blur-sm py-5 px-4 lg:px-6 space-y-5">
                <div className="flex items-center gap-3">
                    <Compass
                        className="size-5 transition-colors duration-500"
                        style={{ color: hue !== null ? `hsl(${hue} 55% 45%)` : "hsl(var(--primary))" }}
                    />
                    <h1 className="text-lg sm:text-xl font-light">{label ?? "Browse"}</h1>
                    {hasFilter && (
                        <button onClick={clear} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                            Clear
                        </button>
                    )}
                </div>

                <div className="space-y-1.5">
                    <span className="text-[10px] tracking-widest uppercase text-muted-foreground/70">Genres</span>
                    <div className="flex flex-wrap gap-1.5">
                        {GENRES.map((g) => (
                            <FilterPill key={g.id} label={g.label} active={genre?.id === g.id} hue={g.hue} onClick={() => toggleGenre(g)} />
                        ))}
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] tracking-widest uppercase text-muted-foreground/70">Countries</span>
                        {!tmdbKey && <span className="text-[9px] text-muted-foreground/50">(requires TMDB key)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {COUNTRIES.map((c) => (
                            <FilterPill key={c.id} label={`${c.flag} ${c.label}`} active={country?.id === c.id} hue={c.hue} onClick={() => toggleCountry(c)} />
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Content ──────────────────────────────────────────── */}
            <div className="py-6">
                {!hasFilter ? (
                    <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-3">
                        <Compass className="size-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground max-w-sm text-pretty">
                            Select a genre, country, or both to discover movies and series.
                        </p>
                    </div>
                ) : needsKey ? (
                    <div className="flex flex-col items-center justify-center py-20 px-4 text-center space-y-3">
                        <p className="text-sm text-muted-foreground max-w-md text-pretty">
                            Country browsing needs a TMDB API key. Add one in{" "}
                            <span className="text-foreground font-medium">Settings → TMDB API Key</span>.
                        </p>
                        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer"
                            className="text-xs text-primary hover:text-primary/80 underline underline-offset-2">
                            Get a free TMDB API key →
                        </a>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 xl:gap-4 items-start">
                        {/* Movies */}
                        <section className="min-w-0">
                            <div className="flex items-center gap-3 px-4 lg:px-6 pb-2">
                                <div className="h-px w-6 transition-colors duration-500"
                                    style={{ backgroundColor: hue !== null ? `hsl(${hue} 55% 45%)` : "hsl(var(--primary))" }} />
                                <Film className="size-4 text-muted-foreground" />
                                <span className="text-xs tracking-widest uppercase text-muted-foreground">Movies · {label}</span>
                                {movieItems.length > 0 && (
                                    <span className="text-xs text-border tabular-nums">{movieItems.length}</span>
                                )}
                            </div>
                            <BrowseGrid
                                items={movieItems}
                                type="movie"
                                isLoading={movies.isLoading}
                                hasMore={movies.hasNextPage}
                                isFetchingMore={movies.isFetchingNextPage}
                                onLoadMore={() => void movies.fetchNextPage()}
                            />
                        </section>

                        {/* Series */}
                        <section className="min-w-0">
                            <div className="flex items-center gap-3 px-4 lg:px-6 pb-2 xl:pt-0 pt-4">
                                <div className="h-px w-6 transition-colors duration-500"
                                    style={{ backgroundColor: hue !== null ? `hsl(${hue} 55% 45%)` : "hsl(var(--primary))" }} />
                                <Tv className="size-4 text-muted-foreground" />
                                <span className="text-xs tracking-widest uppercase text-muted-foreground">Series · {label}</span>
                                {seriesItems.length > 0 && (
                                    <span className="text-xs text-border tabular-nums">{seriesItems.length}</span>
                                )}
                            </div>
                            <BrowseGrid
                                items={seriesItems}
                                type="show"
                                isLoading={series.isLoading}
                                hasMore={series.hasNextPage}
                                isFetchingMore={series.isFetchingNextPage}
                                onLoadMore={() => void series.fetchNextPage()}
                            />
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}
