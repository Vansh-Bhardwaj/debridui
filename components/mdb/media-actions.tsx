"use client";

import { memo, useMemo, useCallback } from "react";
import { type TraktMedia } from "@/lib/trakt";
import { traktClient } from "@/lib/trakt";
import {
    useTraktWatchlistMovies,
    useTraktWatchlistShows,
    useAddToWatchlist,
    useRemoveFromWatchlist,
    useTraktFavoritesMovies,
    useTraktFavoritesShows,
    useAddToFavorites,
    useRemoveFromFavorites,
    useTraktRatingsMovies,
    useTraktRatingsShows,
    useAddRating,
    useRemoveRating,
    useAddToHistory,
    useCheckin,
} from "@/hooks/use-trakt";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Bookmark, Heart, Star, Eye, Radio, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MediaActionsProps {
    media: TraktMedia;
    type: "movie" | "show";
    /** Render as a row of icon buttons (for inline use) */
    variant?: "icons" | "full";
}

/** Trakt action buttons: Watchlist, Favorite, Rate, Watched, Check-in */
export const MediaActions = memo(function MediaActions({ media, type, variant = "icons" }: MediaActionsProps) {
    const hasAuth = !!traktClient.getAccessToken();
    const ids = media.ids;
    const imdbId = ids?.imdb;
    const traktId = ids?.trakt;

    // Watchlist state
    const watchlistMovies = useTraktWatchlistMovies();
    const watchlistShows = useTraktWatchlistShows();
    const addWatchlist = useAddToWatchlist();
    const removeWatchlist = useRemoveFromWatchlist();

    const isInWatchlist = useMemo(() => {
        const items = type === "movie" ? watchlistMovies.data : watchlistShows.data;
        if (!items || !traktId) return false;
        return items.some((i) => {
            const m = type === "movie" ? i.movie : i.show;
            return m?.ids?.trakt === traktId;
        });
    }, [type, watchlistMovies.data, watchlistShows.data, traktId]);

    // Favorites state
    const favMovies = useTraktFavoritesMovies();
    const favShows = useTraktFavoritesShows();
    const addFav = useAddToFavorites();
    const removeFav = useRemoveFromFavorites();

    const isInFavorites = useMemo(() => {
        const items = type === "movie" ? favMovies.data : favShows.data;
        if (!items || !traktId) return false;
        return items.some((i) => {
            const m = type === "movie" ? i.movie : i.show;
            return m?.ids?.trakt === traktId;
        });
    }, [type, favMovies.data, favShows.data, traktId]);

    // Ratings state
    const ratingMovies = useTraktRatingsMovies();
    const ratingShows = useTraktRatingsShows();
    const addRating = useAddRating();
    const removeRating = useRemoveRating();

    const currentRating = useMemo(() => {
        const items = type === "movie" ? ratingMovies.data : ratingShows.data;
        if (!items || !traktId) return 0;
        const found = items.find((i) => {
            const m = type === "movie" ? i.movie : i.show;
            return m?.ids?.trakt === traktId;
        });
        return found?.rating ?? 0;
    }, [type, ratingMovies.data, ratingShows.data, traktId]);

    // History & Check-in
    const addHistory = useAddToHistory();
    const checkin = useCheckin();

    // Handlers
    const handleWatchlistToggle = useCallback(() => {
        if (!hasAuth) return toast.error("Connect Trakt in Settings first");
        const params = { type, imdbId, traktId };
        if (isInWatchlist) {
            removeWatchlist.mutate(params, {
                onSuccess: () => toast.success("Removed from watchlist"),
                onError: () => toast.error("Failed to update watchlist"),
            });
        } else {
            addWatchlist.mutate(params, {
                onSuccess: () => toast.success("Added to watchlist"),
                onError: () => toast.error("Failed to update watchlist"),
            });
        }
    }, [hasAuth, type, imdbId, traktId, isInWatchlist, addWatchlist, removeWatchlist]);

    const handleFavoriteToggle = useCallback(() => {
        if (!hasAuth) return toast.error("Connect Trakt in Settings first");
        const params = { type, imdbId, traktId };
        if (isInFavorites) {
            removeFav.mutate(params, {
                onSuccess: () => toast.success("Removed from favorites"),
                onError: () => toast.error("Failed to update favorites"),
            });
        } else {
            addFav.mutate(params, {
                onSuccess: () => toast.success("Added to favorites"),
                onError: () => toast.error("Failed to update favorites"),
            });
        }
    }, [hasAuth, type, imdbId, traktId, isInFavorites, addFav, removeFav]);

    const handleRate = useCallback(
        (rating: number) => {
            if (!hasAuth) return toast.error("Connect Trakt in Settings first");
            if (rating === currentRating) {
                removeRating.mutate(
                    { type, imdbId, traktId },
                    {
                        onSuccess: () => toast.success("Rating removed"),
                        onError: () => toast.error("Failed to remove rating"),
                    }
                );
            } else {
                addRating.mutate(
                    { type, imdbId, traktId, rating },
                    {
                        onSuccess: () => toast.success(`Rated ${rating}/10`),
                        onError: () => toast.error("Failed to rate"),
                    }
                );
            }
        },
        [hasAuth, type, imdbId, traktId, currentRating, addRating, removeRating]
    );

    const handleMarkWatched = useCallback(() => {
        if (!hasAuth) return toast.error("Connect Trakt in Settings first");
        addHistory.mutate(
            { type, imdbId, traktId },
            {
                onSuccess: () => toast.success("Marked as watched"),
                onError: () => toast.error("Failed to mark as watched"),
            }
        );
    }, [hasAuth, type, imdbId, traktId, addHistory]);

    const handleCheckin = useCallback(() => {
        if (!hasAuth) return toast.error("Connect Trakt in Settings first");
        checkin.mutate(
            { type, imdbId, traktId },
            {
                onSuccess: () => toast.success("Checked in — now showing as watching on Trakt"),
                onError: (e) => {
                    if (e.message.includes("409")) {
                        toast.error("Already checked in to something else");
                    } else {
                        toast.error("Check-in failed");
                    }
                },
            }
        );
    }, [hasAuth, type, imdbId, traktId, checkin]);

    const watchlistLoading = addWatchlist.isPending || removeWatchlist.isPending;
    const favLoading = addFav.isPending || removeFav.isPending;
    const ratingLoading = addRating.isPending || removeRating.isPending;

    if (variant === "full") {
        return (
            <div className="flex flex-col gap-2">
                <Button
                    variant={isInWatchlist ? "default" : "outline"}
                    size="lg"
                    className="w-full gap-2"
                    disabled={watchlistLoading}
                    onClick={handleWatchlistToggle}>
                    {watchlistLoading ? <Loader2 className="size-4 animate-spin" /> : <Bookmark className={cn("size-4", isInWatchlist && "fill-current")} />}
                    {isInWatchlist ? "In Watchlist" : "Watchlist"}
                </Button>
                <Button
                    variant={isInFavorites ? "default" : "outline"}
                    size="lg"
                    className="w-full gap-2"
                    disabled={favLoading}
                    onClick={handleFavoriteToggle}>
                    {favLoading ? <Loader2 className="size-4 animate-spin" /> : <Heart className={cn("size-4", isInFavorites && "fill-current")} />}
                    {isInFavorites ? "Favorited" : "Favorite"}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1">
            {/* Watchlist */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={watchlistLoading}
                        onClick={handleWatchlistToggle}>
                        {watchlistLoading ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Bookmark className={cn("size-4", isInWatchlist && "fill-current text-primary")} />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{isInWatchlist ? "Remove from Watchlist" : "Add to Watchlist"}</TooltipContent>
            </Tooltip>

            {/* Favorite */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-9"
                        disabled={favLoading}
                        onClick={handleFavoriteToggle}>
                        {favLoading ? (
                            <Loader2 className="size-4 animate-spin" />
                        ) : (
                            <Heart className={cn("size-4", isInFavorites && "fill-current text-destructive")} />
                        )}
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{isInFavorites ? "Remove from Favorites" : "Add to Favorites"}</TooltipContent>
            </Tooltip>

            {/* Rate */}
            <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-9" disabled={ratingLoading}>
                                {ratingLoading ? (
                                    <Loader2 className="size-4 animate-spin" />
                                ) : (
                                    <Star className={cn("size-4", currentRating > 0 && "fill-primary text-primary")} />
                                )}
                                {currentRating > 0 && (
                                    <span className="absolute -bottom-0.5 text-[9px] font-bold text-primary">{currentRating}</span>
                                )}
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{currentRating ? `Rated ${currentRating}/10` : "Rate"}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="center" className="min-w-0">
                    <div className="grid grid-cols-5 gap-0.5 p-1">
                        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <DropdownMenuItem
                                key={n}
                                className={cn(
                                    "flex items-center justify-center size-8 p-0 text-xs font-medium cursor-pointer",
                                    n === currentRating && "bg-primary text-primary-foreground"
                                )}
                                onClick={() => handleRate(n)}>
                                {n}
                            </DropdownMenuItem>
                        ))}
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* Mark Watched (movies only — shows are per-episode) */}
            {type === "movie" && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            disabled={addHistory.isPending}
                            onClick={handleMarkWatched}>
                            {addHistory.isPending ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Eye className="size-4" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Mark as Watched</TooltipContent>
                </Tooltip>
            )}

            {/* Check-in */}
            {type === "movie" && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-9"
                            disabled={checkin.isPending}
                            onClick={handleCheckin}>
                            {checkin.isPending ? (
                                <Loader2 className="size-4 animate-spin" />
                            ) : (
                                <Radio className="size-4" />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Check In (show on Trakt profile)</TooltipContent>
                </Tooltip>
            )}
        </div>
    );
});
