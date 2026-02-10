import { useCallback, useRef } from "react";
import { traktClient, TraktClient } from "@/lib/trakt";
import type { ProgressKey } from "@/hooks/use-progress";

type ScrobbleAction = "start" | "pause" | "stop";

/**
 * Hook for Trakt scrobble integration.
 * Sends scrobble events (start/pause/stop) when the user plays content.
 * Requires the user to have a Trakt access token set via settings.
 */
export function useTraktScrobble(progressKey: ProgressKey | null) {
    const lastActionRef = useRef<ScrobbleAction | null>(null);

    const scrobble = useCallback(
        async (action: ScrobbleAction, progressPercent: number) => {
            if (!progressKey || !traktClient.getAccessToken()) return;
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
            } catch (e) {
                console.error("[trakt-scrobble]", action, e);
            }
        },
        [progressKey]
    );

    return { scrobble };
}
