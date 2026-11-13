"use client";

import { useLocalWatchlist, useSetLocalWatchlist } from "@/hooks/use-local-watchlist";
import { useAddToWatchlist, useRemoveFromWatchlist, useTraktWatchlistMovies, useTraktWatchlistShows } from "@/hooks/use-trakt";
import { useUserSettings } from "@/hooks/use-user-settings";
import type { TraktMedia } from "@/lib/trakt";
import { Button } from "@/components/ui/button";
import { Bookmark } from "reicon-react";
import { toast } from "sonner";

export function MyListButton({ media, type }: { media: TraktMedia; type: "movie" | "show" }) {
    const local = useLocalWatchlist();
    const setLocal = useSetLocalWatchlist();
    const { data: settings } = useUserSettings();
    const movies = useTraktWatchlistMovies();
    const shows = useTraktWatchlistShows();
    const add = useAddToWatchlist();
    const remove = useRemoveFromWatchlist();
    const connected = !!settings?.trakt_access_token;
    const matches = (m?: TraktMedia) => !!m && (!!media.ids?.imdb && media.ids.imdb === m.ids?.imdb || !!media.ids?.trakt && media.ids.trakt === m.ids?.trakt || !!media.ids?.tmdb && media.ids.tmdb === m.ids?.tmdb);
    const saved = connected ? (type === "movie" ? movies.data : shows.data)?.some((r) => matches(r.movie ?? r.show)) : local.data?.some((r) => r.type === type && matches(r.media));
    const pending = setLocal.isPending || add.isPending || remove.isPending;
    const loading = connected ? (type === "movie" ? movies.isLoading : shows.isLoading) : local.isLoading;
    async function toggle() {
        try {
            if (connected) await (saved ? remove : add).mutateAsync({ type, imdbId: media.ids?.imdb, traktId: media.ids?.trakt, media });
            else await setLocal.mutateAsync({ type, media, saved: !saved });
        } catch { toast.error("Could not update My List. Please try again."); }
    }
    return <Button data-tv-focusable aria-pressed={!!saved} variant="outline" className="gap-2 min-h-phone-touch" disabled={pending || loading || !!local.error && !connected} onClick={toggle}>
        <Bookmark className="size-4" weight={saved ? "Filled" : "Outline"} />{saved ? "In My List" : "Add to My List"}
    </Button>;
}
