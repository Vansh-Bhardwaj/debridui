import { useQuery, useQueryClient, useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import type { TraktMediaItem } from "@/lib/trakt";
import { getUserAddons, addAddon, removeAddon, toggleAddon, toggleAddonCatalogs, updateAddonOrders } from "@/lib/actions/addons";
import { AddonClient } from "@/lib/addons/client";
import { parseStreams, catalogMetasToMediaItems } from "@/lib/addons/parser";
import { type Addon, type AddonManifest, type AddonSource, type AddonSubtitle, type TvSearchParams, addonSupportsStreams, addonSupportsSubtitles, addonSupportsCatalogs } from "@/lib/addons/types";
import { type CreateAddon } from "@/lib/types";
import { getSubtitleLabel, isSubtitleLanguage } from "@/lib/utils/subtitles";
import { useToastMutation } from "@/lib/utils/mutation-factory";
import { useSettingsStore } from "@/lib/stores/settings";

const USER_ADDONS_KEY = ["user-addons"];

/**
 * Shared manifest query options — DRY factory used by hooks and imperative code.
 * 24-hour stale time; keyed by addon ID.
 */
export function manifestQueryOptions(addon: { id: string; url: string }) {
    return {
        queryKey: ["addon", addon.id, "manifest"] as const,
        queryFn: async () => {
            const client = new AddonClient({ url: addon.url });
            return client.fetchManifest();
        },
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
        gcTime: 24 * 60 * 60 * 1000,
    };
}

/**
 * Imperative version: get only stream-capable addons from a list.
 * Uses queryClient.ensureQueryData for cache-first manifest resolution.
 * Suitable for non-hook contexts (e.g., Zustand stores).
 */
export async function getStreamCapableAddons<T extends { id: string; url: string }>(
    addons: T[],
    qc: { ensureQueryData: <R>(opts: { queryKey: readonly unknown[]; queryFn: () => Promise<R>; staleTime: number }) => Promise<R> }
): Promise<T[]> {
    const manifests = await Promise.all(
        addons.map((a) => qc.ensureQueryData(manifestQueryOptions(a)).catch(() => null as AddonManifest | null))
    );
    return addons.filter((_, i) => {
        const m = manifests[i];
        if (!m?.resources) return true; // unknown → include (safe default)
        return addonSupportsStreams(m);
    });
}

/**
 * Fetch all user addons from database
 */
export function useUserAddons(enabled = true) {
    return useQuery({
        queryKey: USER_ADDONS_KEY,
        queryFn: getUserAddons,
        enabled,
        staleTime: 1 * 60 * 60 * 1000, // 1 hour
    });
}

/**
 * Add a new addon
 */
export function useAddAddon() {
    const queryClient = useQueryClient();

    return useToastMutation(
        (addon: CreateAddon) => addAddon(addon),
        { error: "Failed to add addon" },
        {
            onSuccess: (newAddon) => {
                queryClient.setQueryData<Addon[]>(USER_ADDONS_KEY, (old = []) => [...old, newAddon]);
            },
        }
    );
}

/**
 * Remove an addon with optimistic update
 */
export function useRemoveAddon() {
    const queryClient = useQueryClient();

    return useToastMutation<{ success: boolean }, string, { previousAddons: Addon[] | undefined }>(
        (addonId) => removeAddon(addonId),
        { error: "Failed to remove addon" },
        {
            onMutate: async (addonId) => {
                await queryClient.cancelQueries({ queryKey: USER_ADDONS_KEY });

                const previousAddons = queryClient.getQueryData<Addon[]>(USER_ADDONS_KEY);

                queryClient.setQueryData<Addon[]>(USER_ADDONS_KEY, (old = []) =>
                    old.filter((addon) => addon.id !== addonId)
                );

                return { previousAddons };
            },
            onError: (_error, _variables, context) => {
                if (context?.previousAddons) {
                    queryClient.setQueryData(USER_ADDONS_KEY, context.previousAddons);
                }
            },
            onSettled: (_, __, addonId) => {
                queryClient.invalidateQueries({ queryKey: ["addon", addonId] });
                queryClient.invalidateQueries({ queryKey: USER_ADDONS_KEY });
            },
        }
    );
}

/**
 * Toggle addon enabled status
 */
export function useToggleAddon() {
    const queryClient = useQueryClient();

    return useToastMutation<
        { success: boolean },
        { addonId: string; enabled: boolean },
        { previousAddons: Addon[] | undefined }
    >(
        ({ addonId, enabled }) => toggleAddon(addonId, enabled),
        { error: "Failed to toggle addon" },
        {
            onMutate: async ({ addonId, enabled }) => {
                await queryClient.cancelQueries({ queryKey: USER_ADDONS_KEY });

                const previousAddons = queryClient.getQueryData<Addon[]>(USER_ADDONS_KEY);

                queryClient.setQueryData<Addon[]>(USER_ADDONS_KEY, (old = []) => {
                    return old.map((addon) => (addon.id === addonId ? { ...addon, enabled } : addon));
                });

                return { previousAddons };
            },
            onError: (_error, _variables, context) => {
                if (context?.previousAddons) {
                    queryClient.setQueryData(USER_ADDONS_KEY, context.previousAddons);
                }
            },
            onSettled: () => queryClient.invalidateQueries({ queryKey: USER_ADDONS_KEY }),
        }
    );
}

/**
 * Toggle addon catalog visibility on dashboard
 */
export function useToggleAddonCatalogs() {
    const queryClient = useQueryClient();

    return useToastMutation<
        { success: boolean },
        { addonId: string; showCatalogs: boolean },
        { previousAddons: Addon[] | undefined }
    >(
        ({ addonId, showCatalogs }) => toggleAddonCatalogs(addonId, showCatalogs),
        { error: "Failed to toggle catalogs" },
        {
            onMutate: async ({ addonId, showCatalogs }) => {
                await queryClient.cancelQueries({ queryKey: USER_ADDONS_KEY });

                const previousAddons = queryClient.getQueryData<Addon[]>(USER_ADDONS_KEY);

                queryClient.setQueryData<Addon[]>(USER_ADDONS_KEY, (old = []) => {
                    return old.map((addon) => (addon.id === addonId ? { ...addon, showCatalogs } : addon));
                });

                return { previousAddons };
            },
            onError: (_error, _variables, context) => {
                if (context?.previousAddons) {
                    queryClient.setQueryData(USER_ADDONS_KEY, context.previousAddons);
                }
            },
            onSettled: () => queryClient.invalidateQueries({ queryKey: USER_ADDONS_KEY }),
        }
    );
}

/**
 * Update addon orders (for reordering)
 */
export function useUpdateAddonOrders() {
    const queryClient = useQueryClient();

    return useToastMutation<
        { success: boolean },
        Array<{ id: string; order: number }>,
        { previousAddons: Addon[] | undefined }
    >(
        updateAddonOrders,
        { error: "Failed to reorder addons" },
        {
            onMutate: async (updates) => {
                await queryClient.cancelQueries({ queryKey: USER_ADDONS_KEY });

                const previousAddons = queryClient.getQueryData<Addon[]>(USER_ADDONS_KEY);

                queryClient.setQueryData<Addon[]>(USER_ADDONS_KEY, (old = []) => {
                    const updated = [...old];
                    updates.forEach(({ id, order }) => {
                        const addon = updated.find((a) => a.id === id);
                        if (addon) addon.order = order;
                    });
                    return updated.sort((a, b) => a.order - b.order);
                });

                return { previousAddons };
            },
            onError: (_error, _variables, context) => {
                if (context?.previousAddons) {
                    queryClient.setQueryData(USER_ADDONS_KEY, context.previousAddons);
                }
            },
            onSettled: () => queryClient.invalidateQueries({ queryKey: USER_ADDONS_KEY }),
        }
    );
}

interface UseAddonOptions {
    addonId: string;
    url: string;
    enabled?: boolean;
}

/**
 * Hook to fetch and cache addon manifest (uses shared manifestQueryOptions)
 */
export function useAddon({ addonId, url, enabled = true }: UseAddonOptions) {
    return useQuery({
        ...manifestQueryOptions({ id: addonId, url }),
        enabled,
    });
}

interface UseAddonSourcesOptions {
    imdbId: string;
    mediaType: "movie" | "show";
    tvParams?: TvSearchParams;
}

/**
 * Fetch sources from a single addon
 */
async function fetchAddonSources(
    addon: { id: string; name: string; url: string },
    imdbId: string,
    mediaType: "movie" | "show",
    tvParams?: TvSearchParams
): Promise<AddonSource[]> {
    const client = new AddonClient({ url: addon.url });
    const response = await client.fetchStreams(imdbId, mediaType, tvParams);
    return parseStreams(response.streams, addon.id, addon.name);
}

/**
 * Hook to fetch sources from all enabled addons
 *
 * Following Vercel React best practices:
 * - async-parallel: Each addon has its own query, results show as they arrive
 * - client-swr-dedup: Individual addon queries are cached separately
 * - rerender-dependencies: Uses primitive dependencies (addon IDs)
 */
export function useAddonSources({ imdbId, mediaType, tvParams }: UseAddonSourcesOptions) {
    const { data: addons = [] } = useUserAddons();
    const queryClient = useQueryClient();

    // Stable reference for enabled addons list
    const enabledAddons = useMemo(() => addons.filter((a: Addon) => a.enabled).sort((a: Addon, b: Addon) => a.order - b.order), [addons]);

    // Fetch manifests to determine addon capabilities (shared cache with useAddonSubtitles)
    const manifestQueries = useQueries({
        queries: enabledAddons.map((addon: Addon) => ({
            ...manifestQueryOptions(addon),
            enabled: true,
        })),
    });

    // Filter to only addons that support streams.
    // Safe default: if manifest is not yet loaded/failed, still include (no regression).
    const streamAddons = useMemo(() => {
        return enabledAddons.filter((_: Addon, i: number) => {
            const manifest = manifestQueries[i]?.data;
            if (!manifest?.resources) return true; // unknown → include (safe default)
            return addonSupportsStreams(manifest);
        });
    }, [enabledAddons, manifestQueries]);

    // Individual query per addon for progressive loading
    const queries = useQueries({
        queries: streamAddons.map((addon: Addon) => ({
            queryKey: ["addon", addon.id, "sources", imdbId, mediaType, tvParams] as const,
            queryFn: () => fetchAddonSources(addon, imdbId, mediaType, tvParams),
            staleTime: 3 * 60 * 1000, // 3 minutes
            gcTime: 10 * 60 * 1000, // 10 minutes (don't keep stale sources for hours)
            retry: 1,
            retryDelay: 1000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
        })),
    });

    // Progressive data combination - updates as each addon responds
    const combinedData = useMemo(() => {
        const allSources: AddonSource[] = [];

        for (const query of queries) {
            if (query.data) {
                allSources.push(...(query.data as AddonSource[]));
            }
        }

        // Sort: cached first
        return allSources.sort((a, b) => {
            if (a.isCached && !b.isCached) return -1;
            if (!a.isCached && b.isCached) return 1;
            return 0;
        });
    }, [queries]);

    // Track failed addons
    const failedAddons = useMemo(() => {
        return queries
            .map((query, index) => ({
                query,
                addon: streamAddons[index],
            }))
            .filter(({ query }) => query.isError)
            .map(({ addon }) => addon.name);
    }, [queries, streamAddons]);

    // Loading state: true if manifests or ANY source query is still loading
    const isLoading = manifestQueries.some((q) => q.isLoading) || queries.some((q) => q.isLoading);

    // Retry: clear cache AND actively refetch from all addons
    const retry = () => {
        for (const addon of streamAddons) {
            queryClient.resetQueries({
                queryKey: ["addon", addon.id, "sources", imdbId, mediaType, tvParams],
            });
        }
    };

    return {
        data: combinedData,
        isLoading,
        failedAddons,
        retry,
    };
}



interface UseAddonSubtitlesOptions {
    imdbId: string;
    mediaType: "movie" | "show";
    tvParams?: TvSearchParams;
}

/**
 * Fetch subtitles from all enabled addons that declare "subtitles" in manifest.resources.
 * Returns combined list (addon name prefixed for same lang); only queries addons that support subtitles.
 */
export function useAddonSubtitles({ imdbId, mediaType, tvParams }: UseAddonSubtitlesOptions) {
    const { data: addons = [] } = useUserAddons();
    const subtitleLanguage = useSettingsStore((s) => s.settings.playback.subtitleLanguage);
    const enabledAddons = useMemo(
        () => addons.filter((a: Addon) => a.enabled).sort((a: Addon, b: Addon) => a.order - b.order),
        [addons]
    );

    const manifestQueries = useQueries({
        queries: enabledAddons.map((addon: Addon) => ({
            ...manifestQueryOptions(addon),
            enabled: true,
        })),
    });

    const addonsWithSubtitles = useMemo(() => {
        return enabledAddons.filter((_: Addon, i: number) =>
            addonSupportsSubtitles(manifestQueries[i]?.data ?? {})
        );
    }, [enabledAddons, manifestQueries]);

    type SubtitleQueryData = { addonName: string; subtitles: AddonSubtitle[] };
    const subtitleQueries = useQueries({
        queries: addonsWithSubtitles.map((addon: Addon) => ({
            queryKey: ["addon", addon.id, "subtitles", imdbId, mediaType, tvParams] as const,
            queryFn: async (): Promise<SubtitleQueryData> => {
                const client = new AddonClient({ url: addon.url });
                const res = await client.fetchSubtitles(imdbId, mediaType, tvParams);
                return { addonName: addon.name, subtitles: res.subtitles };
            },
            staleTime: 5 * 60 * 1000,
            enabled: !!imdbId && addonsWithSubtitles.length > 0,
        })),
    });

    const combinedSubtitles = useMemo((): AddonSubtitle[] => {
        const byKey = new Map<string, AddonSubtitle>();
        for (const q of subtitleQueries) {
            const data = q.data as SubtitleQueryData | undefined;
            if (!data?.subtitles) continue;
            const addonName = data.addonName;
            for (const sub of data.subtitles) {
                if (!sub.url || !sub.lang) continue;
                // Only keep subtitles matching the user's preferred language
                if (subtitleLanguage && !isSubtitleLanguage(sub, subtitleLanguage)) continue;
                const key = `${sub.lang}:${sub.url}`;
                if (!byKey.has(key)) {
                    byKey.set(key, {
                        ...sub,
                        name: getSubtitleLabel(sub, addonName),
                    });
                }
            }
        }
        return Array.from(byKey.values());
    }, [subtitleQueries, subtitleLanguage]);

    return {
        data: combinedSubtitles,
        isLoading: manifestQueries.some((q) => q.isLoading) || subtitleQueries.some((q) => q.isLoading),
    };
}

// ── Catalog browsing ─────────────────────────────────────────────

export interface AddonCatalogDef {
    type: string;
    id: string;
    name: string;
    addonId: string;
    addonName: string;
    addonUrl: string;
}

/** Encode a catalog definition into a URL-safe slug: `addonId~type~catalogId` */
export function catalogSlug(catalog: AddonCatalogDef): string {
    return `${catalog.addonId}~${catalog.type}~${catalog.id}`;
}

/** Decode a catalog slug back into its parts. */
export function parseCatalogSlug(slug: string): { addonId: string; type: string; catalogId: string } | null {
    const parts = slug.split("~");
    if (parts.length !== 3) return null;
    return { addonId: parts[0], type: parts[1], catalogId: parts[2] };
}

/**
 * Get all browseable catalog definitions from enabled addons with showCatalogs enabled.
 * Skips search-only catalogs (those requiring a `search` extra).
 */
export function useAddonCatalogDefs() {
    const { data: addons = [] } = useUserAddons();
    const enabledAddons = useMemo(
        () => addons.filter((a: Addon) => a.enabled && a.showCatalogs).sort((a: Addon, b: Addon) => a.order - b.order),
        [addons]
    );

    const manifestQueries = useQueries({
        queries: enabledAddons.map((addon: Addon) => ({
            ...manifestQueryOptions(addon),
            enabled: true,
        })),
    });

    const catalogs = useMemo((): AddonCatalogDef[] => {
        const result: AddonCatalogDef[] = [];
        for (let i = 0; i < enabledAddons.length; i++) {
            const addon = enabledAddons[i];
            const manifest = manifestQueries[i]?.data;
            if (!manifest || !addonSupportsCatalogs(manifest)) continue;

            for (const cat of manifest.catalogs ?? []) {
                const isSearchOnly = cat.extra?.some((e) => e.name === "search" && e.isRequired);
                if (isSearchOnly) continue;

                result.push({
                    type: cat.type,
                    id: cat.id,
                    name: cat.name ?? cat.id,
                    addonId: addon.id,
                    addonName: addon.name,
                    addonUrl: addon.url,
                });
            }
        }
        return result;
    }, [enabledAddons, manifestQueries]);

    const isLoading = manifestQueries.some((q) => q.isLoading);
    return { data: catalogs, isLoading };
}

/**
 * Fetch content for a single addon catalog.
 * Returns TraktMediaItem[] for reuse with MediaSection / MediaCard.
 */
export function useAddonCatalog(catalog: AddonCatalogDef | null, enabled = true): UseQueryResult<TraktMediaItem[]> {
    return useQuery({
        queryKey: ["addon", catalog?.addonId, "catalog", catalog?.type, catalog?.id],
        queryFn: async () => {
            if (!catalog) return [];
            const client = new AddonClient({ url: catalog.addonUrl });
            const res = await client.fetchCatalog(catalog.type, catalog.id);
            return catalogMetasToMediaItems(res.metas);
        },
        enabled: enabled && !!catalog,
        staleTime: 30 * 60 * 1000,
        retry: 1,
    });
}

/** Resolve a single catalog definition by its slug parts. */
export function useAddonCatalogDef(addonId: string, type: string, catalogId: string) {
    const { data: catalogs = [], isLoading } = useAddonCatalogDefs();
    const catalog = useMemo(
        () => catalogs.find((c) => c.addonId === addonId && c.type === type && c.id === catalogId) ?? null,
        [catalogs, addonId, type, catalogId]
    );
    return { data: catalog, isLoading };
}
