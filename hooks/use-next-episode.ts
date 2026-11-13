"use client";

import { useProfile } from "./use-profile";
import { useQuery } from "@tanstack/react-query";
import { showEpisodes } from "@/components/mdb/home-data";
import { nextAiredEpisode } from "@/components/mdb/home-selection";
import type { TvSearchParams } from "@/lib/addons/types";

export function useNextEpisode(imdbId: string | undefined, type: "movie" | "show" | undefined, season?: number, episode?: number): TvSearchParams | null {
    const { activeProfile: { id: profileId } } = useProfile();
    const { data } = useQuery({
        queryKey: ["next-episode", profileId, imdbId],
        queryFn: () => showEpisodes(imdbId!),
        staleTime: 3600000,
        refetchOnWindowFocus: false,
        enabled: !!imdbId && type === "show" && season != null && episode != null,
    });
    return data && season != null && episode != null ? nextAiredEpisode(data, season, episode) : null;
}
