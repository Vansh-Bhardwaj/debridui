import { useEffect } from "react";
import { getUserSettings, saveUserSettings, disconnectTrakt } from "@/lib/actions/settings";
import type { ServerSettings } from "@/lib/types";
import { traktClient } from "@/lib/trakt";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useProfile } from "./use-profile";
import { hydrateSettingsFromServer } from "./profile-settings";
export { hydrateSettingsFromServer } from "./profile-settings";

export function useUserSettings(enabled = true) {
    const { activeProfile } = useProfile();
    const query = useQuery({
        queryKey: ["user-settings", activeProfile.id],
        queryFn: () => getUserSettings(),
        enabled,
        staleTime: 60 * 60 * 1000, // 1 hour
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (query.data) hydrateSettingsFromServer(query.data);
    }, [query.data]);

    return query;
}

export function useSaveUserSettings() {
    const { activeProfile } = useProfile();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (settings: Partial<ServerSettings>) => saveUserSettings(settings),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["user-settings", activeProfile.id] });
        },
    });
}

export function useDisconnectTrakt() {
    const { activeProfile } = useProfile();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => disconnectTrakt(),
        onSuccess: () => {
            traktClient.setAccessToken("");
            queryClient.invalidateQueries({ queryKey: ["user-settings", activeProfile.id] });
        },
    });
}
