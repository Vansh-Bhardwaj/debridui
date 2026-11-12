import { QueryClient, type Query } from "@tanstack/react-query";
import { get, set, del } from "idb-keyval";
import { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { QUERY_CACHE_STALE_TIME, QUERY_CACHE_GC_TIME, QUERY_CACHE_IDB_MAX_AGE } from "./constants";

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= 2) return false;

    if (error instanceof Error) {
        const message = error.message.toLowerCase();

        if (message.includes("unauthorized") || message.includes("forbidden") || message.includes("invalid")) {
            return false;
        }

        if (/\b4\d{2}\b/.test(message)) {
            return false;
        }

        if (message.includes("abort") || message.includes("timeout")) {
            return failureCount < 1;
        }
    }

    return true;
}

function createIDBPersister(idbValidKey: IDBValidKey = "reactQuery") {
    return {
        persistClient: async (client: PersistedClient) => {
            await set(idbValidKey, client);
        },
        restoreClient: async () => {
            return await get<PersistedClient>(idbValidKey);
        },
        removeClient: async () => {
            await del(idbValidKey);
        },
    } satisfies Persister;
}

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            gcTime: QUERY_CACHE_GC_TIME,
            staleTime: QUERY_CACHE_STALE_TIME,
            retry: shouldRetryQuery,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
        },
        mutations: {
            retry: false,
        },
    },
});

const persister = createIDBPersister("DEBRIDUI_CACHE");
// Playback links carry short-lived tokens and provider stream sessions that only
// live in memory (audio/quality switching) — never restore them after a reload.
const isPlaybackLinkQuery = (key: readonly unknown[]) =>
    key[1] === "getDownloadLink" || (key[0] === "preview" && key[1] === "streaming-links");

// Bump buster to drop persisted caches whose shape/URLs changed
// (v2: TMDB images no longer proxied; v3: playback links no longer persisted).
export const persistOptions = {
    persister,
    maxAge: QUERY_CACHE_IDB_MAX_AGE,
    buster: "v3",
    dehydrateOptions: {
        shouldDehydrateQuery: (query: Query) => query.state.status === "success" && !isPlaybackLinkQuery(query.queryKey),
    },
};
