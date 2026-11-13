"use client";

import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { TraktMedia, TraktMediaItem } from "@/lib/trakt";

type Ids = TraktMedia["ids"] | undefined;

/** Every id a title is known by, so an IMDb-keyed row and a TMDB-keyed row still match. */
export function idKeys(ids: Ids): string[] {
    if (!ids) return [];
    const keys: string[] = [];
    if (ids.imdb) keys.push(`imdb:${ids.imdb}`);
    if (ids.tmdb) keys.push(`tmdb:${ids.tmdb}`);
    if (ids.trakt) keys.push(`trakt:${ids.trakt}`);
    return keys;
}

const itemIds = (item: TraktMediaItem): Ids => (item.movie ?? item.show)?.ids;

export function dedupeItems(items: TraktMediaItem[], shown: ReadonlySet<string>): TraktMediaItem[] {
    return items.filter((item) => !idKeys(itemIds(item)).some((key) => shown.has(key)));
}

// Display-only registry of what our own home rows are showing right now. Rows replace their
// entry whenever their content changes and drop it on unmount, so nothing is hidden for good.
const useShownStore = create<{ rows: Record<string, string[]> }>(() => ({ rows: {} }));

export function useRegisterShown(rowId: string, ids: Ids[]) {
    const signature = ids.flatMap(idKeys).join(",");
    useEffect(() => {
        useShownStore.setState((s) => ({ rows: { ...s.rows, [rowId]: signature ? signature.split(",") : [] } }));
        return () => useShownStore.setState((s) => {
            const { [rowId]: _removed, ...rows } = s.rows;
            return { rows };
        });
    }, [rowId, signature]);
}

export function useShownIds(): ReadonlySet<string> {
    const rows = useShownStore((s) => s.rows);
    return useMemo(() => new Set(Object.values(rows).flat()), [rows]);
}
