import { getUserSettings, saveUserSettings, disconnectTrakt } from "@/lib/actions/settings";
import type { ServerSettings } from "@/lib/types";
import { useSettingsStore } from "@/lib/stores/settings";
import { traktClient } from "@/lib/trakt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const USER_SETTINGS_KEY = ["user-settings"];

/** Hydrate Zustand store from server settings */
export function hydrateSettingsFromServer(settings: ServerSettings | null) {
    if (!settings) return;
    const { set } = useSettingsStore.getState();
    if (settings.tmdb_api_key !== undefined) set("tmdbApiKey", settings.tmdb_api_key);
    // Hydrate Trakt access token onto the global client
    if (settings.trakt_access_token) {
        traktClient.setAccessToken(settings.trakt_access_token);
    }
}

export function useUserSettings(enabled = true) {
    const query = useQuery({
        queryKey: USER_SETTINGS_KEY,
        queryFn: () => getUserSettings(),
        enabled,
        staleTime: 60 * 60 * 1000, // 1 hour
        refetchOnWindowFocus: false,
    });

    // Hydrate Trakt token whenever settings data is available.
    // This ensures the global traktClient can make authenticated requests
    // regardless of which page the user visits first.
    if (query.data?.trakt_access_token && traktClient.getAccessToken() !== query.data.trakt_access_token) {
        traktClient.setAccessToken(query.data.trakt_access_token);
    }

    return query;
}

export function useSaveUserSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (settings: Partial<ServerSettings>) => saveUserSettings(settings),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: USER_SETTINGS_KEY });
        },
    });
}

export function useDisconnectTrakt() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => disconnectTrakt(),
        onSuccess: () => {
            traktClient.setAccessToken("");
            queryClient.invalidateQueries({ queryKey: USER_SETTINGS_KEY });
        },
    });
}
