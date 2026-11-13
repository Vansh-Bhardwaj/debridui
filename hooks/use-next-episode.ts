"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { traktClient } from "@/lib/trakt";
import type { TvSearchParams } from "@/lib/addons/types";

/**
 * The episode after season/episode from Trakt's season list: handles season
 * transitions, null when the show has nothing further aired.
 */
export function useNextEpisode(imdbId: string | undefined, type: "movie" | "show" | undefined, season?: number, episode?: number): TvSearchParams | null {
    const { data: seasons } = useQuery({
        queryKey: ["trakt", "show", "seasons", imdbId],
        queryFn: () => traktClient.getShowSeasons(imdbId!),
        staleTime: 24 * 60 * 60 * 1000,
        enabled: !!imdbId && type === "show" && !!season && !!episode,
    });

    return useMemo(() => {
        if (!seasons || !season || !episode) return null;
        const regular = seasons.filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
        const current = regular.find((s) => s.number === season);
        if (!current) return null;
        if (episode < (current.aired_episodes ?? 0)) return { season, episode: episode + 1 };
        const next = regular.find((s) => s.number > season && (s.aired_episodes ?? 0) > 0);
        return next ? { season: next.number, episode: 1 } : null;
    }, [seasons, season, episode]);
}
