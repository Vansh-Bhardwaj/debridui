"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useProfile } from "./use-profile";

function subscribe(callback: () => void) {
    window.addEventListener("storage", callback);
    window.addEventListener("dui-season", callback);
    return () => { window.removeEventListener("storage", callback); window.removeEventListener("dui-season", callback); };
}

export function useRememberedSeason(showId: string) {
    const { activeProfile } = useProfile();
    const key = `season:${activeProfile.id}:${showId}`;
    const getSnapshot = useCallback(() => {
        try {
            const stored = localStorage.getItem(key);
            const value = stored === null ? NaN : Number(stored);
            return Number.isInteger(value) && value >= 0 ? value : null;
        } catch { return null; }
    }, [key]);
    const value = useSyncExternalStore(subscribe, getSnapshot, () => null);
    const save = useCallback((season: number) => {
        try { localStorage.setItem(key, String(season)); window.dispatchEvent(new Event("dui-season")); } catch { /* Storage may be unavailable. */ }
    }, [key]);
    return [value, save] as const;
}
