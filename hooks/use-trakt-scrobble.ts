import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { traktClient, TraktClient, TraktError, maintainShowOnWatchlist } from "@/lib/trakt";
import type { ProgressKey } from "@/hooks/use-progress";
import { useUserSettings } from "@/hooks/use-user-settings";

type ScrobbleAction = "start" | "pause" | "stop";
const WATCHED_FALLBACK_THRESHOLD = 95;

/**
 * Hook for Trakt scrobble integration.
 * Sends scrobble events (start/pause/stop) when the user plays content.
 * Requires the user to have a Trakt access token set via settings.
 */
export function useTraktScrobble(progressKey: ProgressKey | null) {
    const lastActionRef = useRef<ScrobbleAction | null>(null);
    const fallbackMarkedRef = useRef<string | null>(null);
    const queryClient = useQueryClient();
    const { data: settings } = useUserSettings(true);

    const progressIdentity = progressKey
        ? `${progressKey.imdbId}:${progressKey.type}:${progressKey.season ?? "_"}:${progressKey.episode ?? "_"}`
        : null;

    useEffect(() => {
        lastActionRef.current = null;
        fallbackMarkedRef.current = null;
    }, [progressIdentity]);

    const scrobble = useCallback(
        async (action: ScrobbleAction, progressPercent: number) => {
            if (!progressKey || !(settings?.trakt_access_token || traktClient.getAccessToken())) return;
            // Avoid sending duplicate consecutive actions
            if (action === lastActionRef.current && action !== "stop") return;
            lastActionRef.current = action;

            const request = TraktClient.buildScrobbleRequest(
                progressKey.imdbId,
                progressKey.type,
                Math.min(100, Math.max(0, progressPercent)),
                progressKey.season,
                progressKey.episode
            );

            try {
                if (action === "start") await traktClient.scrobbleStart(request);
                else if (action === "pause") await traktClient.scrobblePause(request, action === "pause");
                else await traktClient.scrobbleStop(request, action === "stop");

                // When scrobble stops at ≥80%, Trakt auto‑marks the episode as watched
                // and also auto-removes the show from the user's watchlist. Counter that
                // removal unless the show is now fully watched.
                if (action === "stop" && progressPercent >= 80 && progressKey.type === "show") {
                    // Give Trakt a moment to register the history write before we check progress
                    setTimeout(async () => {
                        await maintainShowOnWatchlist({ imdb: progressKey.imdbId }, progressKey.imdbId);
                        queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                        queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
                    }, 2000);
                }
            } catch (e) {
                // Skip the history-write fallback on transient rate-limit / auth
                // errors — firing another Trakt call immediately just multiplies
                // the rate hit. On 4xx except 401, let Trakt cool down.
                const status = e instanceof TraktError ? e.status : undefined;
                const isRateOrBlocked = status === 429 || status === 403 || status === 502;

                if (
                    !isRateOrBlocked &&
                    action === "stop" &&
                    progressPercent >= WATCHED_FALLBACK_THRESHOLD &&
                    fallbackMarkedRef.current !== progressIdentity
                ) {
                    try {
                        if (progressKey.type === "show" && progressKey.season != null && progressKey.episode != null) {
                            await traktClient.addEpisodesToHistory({ imdb: progressKey.imdbId }, progressKey.season, [
                                progressKey.episode,
                            ]);
                        } else if (progressKey.type === "movie") {
                            await traktClient.addToHistory({ movies: [{ ids: { imdb: progressKey.imdbId } }] });
                        }

                        fallbackMarkedRef.current = progressIdentity;
                        // Counter Trakt's watchlist auto-removal unless fully watched.
                        if (progressKey.type === "show") {
                            setTimeout(async () => {
                                await maintainShowOnWatchlist({ imdb: progressKey.imdbId }, progressKey.imdbId);
                                queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                                queryClient.invalidateQueries({ queryKey: ["trakt", "watchlist"] });
                            }, 2000);
                        } else {
                            setTimeout(() => {
                                queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                            }, 2000);
                        }
                    } catch (historyError) {
                        console.error("[trakt-history-fallback]", historyError);
                    }
                }
                console.error("[trakt-scrobble]", action, e);
            }
        },
        [progressIdentity, progressKey, queryClient, settings?.trakt_access_token]
    );

    return { scrobble };
}
