"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { getFindTorrentsCacheKey } from "@/lib/utils/cache-keys";
import { type DebridFile, AccountType } from "@/lib/types";
import { traktClient, type TraktSearchResult } from "@/lib/trakt";
import { searchTVMaze } from "@/lib/tvmaze";
import type TorBoxClient from "@/lib/clients/torbox";
import type { TorBoxSearchResult } from "@/lib/clients/torbox";

interface UseSearchLogicOptions {
    query: string;
    enabled?: boolean;
}

export function useSearchLogic({ query, enabled = true }: UseSearchLogicOptions) {
    const { client, currentUser, currentAccount } = useAuthGuaranteed();
    const trimmedQuery = query.trim();
    const minQueryLength = 3;
    const shouldSearch = enabled && trimmedQuery.length >= minQueryLength;

    // Trakt search for movies and TV shows, supplemented by TVMaze for better TV coverage
    const { data: traktResults, isLoading: isTraktSearching } = useQuery({
        queryKey: ["trakt", "search", currentAccount.id, trimmedQuery],
        queryFn: async (): Promise<TraktSearchResult[]> => {
            const traktData = await traktClient.search(trimmedQuery, ["movie", "show"]);

            // If Trakt returned few show results, supplement with TVMaze
            const showCount = traktData.filter((r) => r.show).length;
            if (showCount < 3) {
                try {
                    const tvmazeResults = await searchTVMaze(trimmedQuery);
                    // Collect existing IMDb IDs to avoid duplicates
                    const existingImdb = new Set(
                        traktData
                            .map((r) => r.show?.ids?.imdb || r.movie?.ids?.imdb)
                            .filter(Boolean)
                    );

                    for (const result of tvmazeResults) {
                        if (!result.show) continue;
                        const imdb = result.show.externals?.imdb;
                        // Only include shows with IMDb IDs — needed for navigation
                        if (!imdb) continue;
                        if (existingImdb.has(imdb)) continue;
                        existingImdb.add(imdb);

                        traktData.push({
                            type: "show",
                            score: result.score * 100,
                            show: {
                                title: result.show.name || "Unknown",
                                year: result.show.premiered ? parseInt(result.show.premiered.slice(0, 4), 10) || 0 : 0,
                                ids: {
                                    trakt: 0,
                                    slug: imdb,
                                    tmdb: 0,
                                    imdb,
                                    tvdb: result.show.externals?.thetvdb ?? undefined,
                                },
                                images: {
                                    poster: result.show.image?.original ? [result.show.image.original] : [],
                                    fanart: [],
                                    logo: [],
                                    clearart: [],
                                    banner: [],
                                    thumb: [],
                                    headshot: [],
                                    screenshot: [],
                                },
                                overview: result.show.summary?.replace(/<[^>]+>/g, "") ?? undefined,
                                rating: result.show.rating?.average ?? undefined,
                                genres: result.show.genres,
                                status: result.show.status?.toLowerCase(),
                            },
                        });
                    }
                } catch {
                    // TVMaze supplementation failed — use Trakt results as-is
                }
            }

            return traktData;
        },
        placeholderData: keepPreviousData,
        enabled: shouldSearch,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    });

    // File search using debrid client
    const { data: fileResults, isLoading: isFileSearching } = useQuery<DebridFile[]>({
        queryKey: getFindTorrentsCacheKey(currentAccount.id, trimmedQuery),
        queryFn: () => client.findTorrents(trimmedQuery),
        placeholderData: keepPreviousData,
        enabled: shouldSearch,
        staleTime: 30_000, // 30s — file lists don't change in real-time
        gcTime: 60_000,
    });

    const isTorBoxUser = currentUser.type === AccountType.TORBOX;

    const { data: sourceResults, isLoading: isSourceSearching } = useQuery<TorBoxSearchResult[]>({
        queryKey: ["torbox", "search", currentAccount.id, trimmedQuery],
        queryFn: () => (client as TorBoxClient).searchTorrents(trimmedQuery),
        placeholderData: keepPreviousData,
        enabled: shouldSearch && isTorBoxUser,
        staleTime: 60 * 60 * 1000,
        gcTime: 6 * 60 * 60 * 1000,
    });

    const hasFileResults = !!fileResults?.length;
    const hasTraktResults = !!traktResults?.length;
    const hasSourceResults = isTorBoxUser && !!sourceResults?.length;
    const bothLoaded = !isFileSearching && !isTraktSearching && (!isTorBoxUser || !isSourceSearching);
    const hasAnyResults = hasFileResults || hasTraktResults || hasSourceResults;

    return {
        fileResults,
        traktResults,
        sourceResults: isTorBoxUser ? sourceResults : undefined,
        isFileSearching,
        isTraktSearching,
        isSourceSearching: isTorBoxUser ? isSourceSearching : false,
        bothLoaded,
        hasFileResults,
        hasTraktResults,
        hasSourceResults,
        hasAnyResults,
    };
}
