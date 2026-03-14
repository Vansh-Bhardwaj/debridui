import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { traktClient, TraktClient } from "@/lib/trakt";
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
                else if (action === "pause") await traktClient.scrobblePause(request);
                else await traktClient.scrobbleStop(request);

                // When scrobble stops at ≥80%, Trakt auto‑marks the episode as watched.
                // Invalidate the show's watched‑progress cache so the UI reflects it.
                if (action === "stop" && progressPercent >= 80 && progressKey.type === "show") {
                    setTimeout(() => {
                        queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                    }, 2000);
                }
            } catch (e) {
                if (
                    action === "stop" &&
                    progressPercent >= WATCHED_FALLBACK_THRESHOLD &&
                    fallbackMarkedRef.current !== progressIdentity
                ) {
                    try {
                        if (progressKey.type === "show" && progressKey.season != null && progressKey.episode != null) {
                            await traktClient.addEpisodesToHistory(
                                { imdb: progressKey.imdbId },
                                progressKey.season,
                                [progressKey.episode]
                            );
                        } else if (progressKey.type === "movie") {
                            await traktClient.addToHistory({ movies: [{ ids: { imdb: progressKey.imdbId } }] });
                        }

                        fallbackMarkedRef.current = progressIdentity;
                        setTimeout(() => {
                            queryClient.invalidateQueries({ queryKey: ["trakt", "show", "progress"] });
                        }, 2000);
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
