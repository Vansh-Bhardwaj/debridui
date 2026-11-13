"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getLocalWatchlist, setLocalWatchlist } from "@/lib/actions/watchlist";
import { useProfile } from "./use-profile";
import type { TraktMedia } from "@/lib/trakt";

export function useLocalWatchlist() {
    const { activeProfile } = useProfile();
    return useQuery({ queryKey: ["local-watchlist", activeProfile.id], queryFn: () => getLocalWatchlist(activeProfile.id), staleTime: 300000, refetchOnWindowFocus: false });
}

export function useSetLocalWatchlist() {
    const { activeProfile } = useProfile();
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ type, media, saved }: { type: "movie" | "show"; media: TraktMedia; saved: boolean }) => setLocalWatchlist(type, media, saved, activeProfile.id),
        onSuccess: () => { client.invalidateQueries({ queryKey: ["local-watchlist", activeProfile.id] }); },
    });
}
