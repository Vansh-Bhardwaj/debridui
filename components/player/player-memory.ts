import { useCallback, useEffect, useState, type RefObject } from "react";
import { useSettingsStore } from "@/lib/stores/settings";

export type ShowLanguages = { audio?: string; subtitle?: string };

const languageKey = (profileId: string, imdbId: string) => `dui-show-lang:${profileId}:${imdbId}`;

/** Audio/subtitle language last picked for a show by this profile, on this device. */
export function readShowLanguages(profileId: string, imdbId?: string): ShowLanguages {
    if (!imdbId) return {};
    try {
        return JSON.parse(localStorage.getItem(languageKey(profileId, imdbId)) ?? "{}") as ShowLanguages;
    } catch {
        return {};
    }
}

export function rememberShowLanguage(profileId: string, imdbId: string | undefined, kind: keyof ShowLanguages, language: string | undefined) {
    if (!imdbId || !language) return;
    try {
        localStorage.setItem(languageKey(profileId, imdbId), JSON.stringify({ ...readShowLanguages(profileId, imdbId), [kind]: language }));
    } catch { /* storage blocked: the pick still applies to this episode */ }
}

// Episodes auto-played in a row with no input. Module-level so it survives the player remounting per episode.
let unattended = 0;
const STILL_WATCHING_AFTER = 3;
const resetUnattended = () => { unattended = 0; };

/** Routes automatic next-episode advances through an "Are you still watching?" check. */
export function useStillWatching(videoRef: RefObject<HTMLVideoElement | null>) {
    const enabled = useSettingsStore((s) => s.settings.playback.stillWatchingPrompt);
    const [pending, setPending] = useState<(() => void) | null>(null);
    useEffect(() => {
        const events = ["keydown", "pointerdown", "wheel"] as const;
        events.forEach((e) => window.addEventListener(e, resetUnattended, true));
        return () => events.forEach((e) => window.removeEventListener(e, resetUnattended, true));
    }, []);
    const autoAdvance = useCallback((next: () => void) => {
        if (enabled && unattended >= STILL_WATCHING_AFTER) {
            const video = videoRef.current as (HTMLVideoElement & { webkitExitFullscreen?: () => void }) | null;
            video?.pause();
            // Apple's fullscreen player would hide the prompt.
            video?.webkitExitFullscreen?.();
            setPending(() => next);
            return;
        }
        unattended++;
        next();
    }, [enabled, videoRef]);
    const answer = useCallback((keepWatching: boolean) => {
        setPending(null);
        if (keepWatching) pending?.();
    }, [pending]);
    return { asking: pending !== null, autoAdvance, answer };
}
