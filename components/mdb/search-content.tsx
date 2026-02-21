"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "@bprogress/next/app";
import { CommandInput, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Search, X, Clock } from "lucide-react";
import { useSearchLogic } from "@/hooks/use-search-logic";
import { SearchResults } from "./search-results";
import { type DebridFile } from "@/lib/types";
import { type TraktSearchResult } from "@/lib/trakt";
import { cn } from "@/lib/utils";

const RECENT_SEARCHES_KEY = "debridui-recent-searches";
const MAX_RECENT = 8;

function loadRecentSearches(): string[] {
    try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]") as string[];
    } catch {
        return [];
    }
}

function saveRecentSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return;
    try {
        const existing = loadRecentSearches();
        const updated = [trimmed, ...existing.filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    } catch { }
}

interface SearchContentProps {
    defaultQuery?: string;
    onClose?: () => void;
    variant?: "modal" | "page";
    className?: string;
    autoFocus?: boolean;
}

export function SearchContent({
    defaultQuery = "",
    onClose,
    variant = "modal",
    className,
    autoFocus = false,
}: SearchContentProps) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState(defaultQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(defaultQuery);
    const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());

    // Debounce the search query
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

    const { fileResults, traktResults, sourceResults, isFileSearching, isTraktSearching, isSourceSearching } =
        useSearchLogic({
            query: debouncedQuery,
            enabled: true,
        });

    const handleFileSelect = useCallback(
        (file: DebridFile) => {
            if (debouncedQuery) {
                saveRecentSearch(debouncedQuery);
                setRecentSearches(loadRecentSearches());
            }
            const searchParams = new URLSearchParams();
            searchParams.set("q", `id:${file.id}`);
            router.push(`/files?${searchParams.toString()}`);

            if (variant === "modal" && onClose) {
                onClose();
                setQuery("");
            }
        },
        [router, onClose, variant, debouncedQuery]
    );

    const handleMediaSelect = useCallback(
        (result: TraktSearchResult) => {
            if (debouncedQuery) {
                saveRecentSearch(debouncedQuery);
                setRecentSearches(loadRecentSearches());
            }
            const media = result.movie || result.show;
            const slug = media?.ids?.slug || media?.ids?.imdb;
            if (!slug) return;

            const type = result.movie ? "movie" : "show";
            router.push(`/${type}s/${slug}`);

            if (variant === "modal" && onClose) {
                onClose();
                setQuery("");
            }
        },
        [router, onClose, variant, debouncedQuery]
    );

    const clearRecentSearches = useCallback(() => {
        try { localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { }
        setRecentSearches([]);
    }, []);

    const removeRecentSearch = useCallback((term: string) => {
        try {
            const updated = loadRecentSearches().filter((q) => q !== term);
            localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
            setRecentSearches(updated);
        } catch { }
    }, []);

    if (variant === "modal") {
        const showRecent = query.trim().length === 0 && recentSearches.length > 0;
        return (
            <>
                <CommandInput
                    placeholder="Search movies, TV shows, and files..."
                    value={query}
                    onValueChange={setQuery}
                    autoFocus={autoFocus}
                    className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 h-11 sm:h-12 text-sm sm:text-base"
                />
                {showRecent && (
                    <div className="border-t border-border/50 px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] tracking-widest uppercase text-muted-foreground flex items-center gap-1.5">
                                <Clock className="size-3" />
                                Recent
                            </span>
                            <button
                                onClick={clearRecentSearches}
                                className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
                                Clear all
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {recentSearches.map((term) => (
                                <div key={term} className="flex items-center gap-0 border border-border/50 rounded-sm bg-muted/20 hover:bg-muted/40 transition-colors text-xs">
                                    <button
                                        className="px-2.5 py-1 text-foreground/80"
                                        onClick={() => setQuery(term)}>
                                        {term}
                                    </button>
                                    <button
                                        className="pr-1.5 pl-0.5 py-1 text-muted-foreground/50 hover:text-foreground transition-colors"
                                        onClick={() => removeRecentSearch(term)}
                                        aria-label={`Remove ${term}`}>
                                        <X className="size-3" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <CommandList className={cn("h-[70vh] sm:h-[75vh] overflow-y-auto", className)}>
                    <SearchResults
                        query={debouncedQuery}
                        fileResults={fileResults}
                        traktResults={traktResults}
                        sourceResults={sourceResults}
                        isFileSearching={isFileSearching}
                        isTraktSearching={isTraktSearching}
                        isSourceSearching={isSourceSearching}
                        onFileSelect={handleFileSelect}
                        onMediaSelect={handleMediaSelect}
                        variant="modal"
                    />
                </CommandList>
            </>
        );
    }

    // Page variant
    return (
        <div className={cn("space-y-8", className)}>
            <form
                className="relative"
                onSubmit={(e) => {
                    e.preventDefault();
                    inputRef.current?.blur();
                }}>
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                    ref={inputRef}
                    type="search"
                    placeholder="Search movies, TV shows, and files..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus={autoFocus}
                    className="pl-11 h-12 text-base border-border/50 bg-transparent"
                />
            </form>

            <SearchResults
                query={debouncedQuery}
                fileResults={fileResults}
                traktResults={traktResults}
                sourceResults={sourceResults}
                isFileSearching={isFileSearching}
                isTraktSearching={isTraktSearching}
                isSourceSearching={isSourceSearching}
                onFileSelect={handleFileSelect}
                onMediaSelect={handleMediaSelect}
                variant="page"
            />
        </div>
    );
}
