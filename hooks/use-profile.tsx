"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { listProfiles, setActiveProfile } from "@/lib/actions/profiles";
import { getProfilePreferences, getUserSettings, saveProfilePreferences } from "@/lib/actions/settings";
import { loadProfilePreferences, profilePreferencesSnapshot, useSettingsStore } from "@/lib/stores/settings";
import { hydrateSettingsFromServer } from "./profile-settings";
import { migrateProgressKeys } from "./profile-storage";
import { SplashScreen } from "@/components/auth/splash-screen";
import { SplashErrorScreen } from "@/components/auth/splash-error-screen";
import { toast } from "sonner";
import { traktClient } from "@/lib/trakt";

type ProfileList = Awaited<ReturnType<typeof listProfiles>>;
export type Profile = ProfileList["profiles"][number];
type ProfileContextValue = {
    profiles: Profile[];
    activeProfile: Profile;
    switchProfile: (id: string) => Promise<void>;
    refresh: () => Promise<void>;
};
const ProfileContext = createContext<ProfileContextValue | null>(null);
const perProfile = new Set(["trakt", "user-settings", "profile-preferences", "continue-watching", "watched-ids", "watch-history", "history", "progress"]);

export function useProfile() {
    const context = useContext(ProfileContext);
    if (!context) throw new Error("useProfile must be used within ProfileProvider");
    return context;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
    const { data: session } = authClient.useSession();
    const queryClient = useQueryClient();
    const queryKey = ["profiles", session?.user.id];
    const query = useQuery({ queryKey, queryFn: () => listProfiles(), enabled: !!session, staleTime: 0, refetchOnWindowFocus: false });
    const [readyId, setReadyId] = useState<string | null>(null);
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const saving = useRef<Promise<unknown>>(Promise.resolve());
    const activeProfile = query.data?.profiles.find((p) => p.id === query.data.activeProfileId);
    const firstId = query.data?.profiles[0]?.id;

    useEffect(() => {
        if (query.isFetching || !activeProfile || !firstId || switching || readyId === activeProfile.id) return;
        let cancelled = false;
        const initialize = async () => {
            traktClient.reset();
            migrateProgressKeys(localStorage, firstId);
            const [settings, preferences] = await Promise.all([
                queryClient.fetchQuery({ queryKey: ["user-settings", activeProfile.id], queryFn: () => getUserSettings(), staleTime: 0 }),
                queryClient.fetchQuery({ queryKey: ["profile-preferences", activeProfile.id], queryFn: () => getProfilePreferences(), staleTime: 0 }),
            ]);
            if (cancelled) return;
            await loadProfilePreferences(activeProfile.id, firstId, preferences);
            if (cancelled) return;
            hydrateSettingsFromServer(settings);
            setReadyId(activeProfile.id);
        };
        void initialize().catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error("Failed to load profile")); });
        return () => { cancelled = true; };
    }, [activeProfile, firstId, switching, readyId, queryClient, query.isFetching]);

    useEffect(() => {
        if (!readyId || readyId !== activeProfile?.id || switching) return;
        let snapshot = JSON.stringify(profilePreferencesSnapshot());
        return useSettingsStore.subscribe(() => {
            const preferences = profilePreferencesSnapshot();
            const next = JSON.stringify(preferences);
            if (next === snapshot) return;
            snapshot = next;
            // Serialize saves so a switch can wait before changing the server cookie.
            saving.current = saving.current.then(() => saveProfilePreferences(preferences)).catch(() => { toast.error("Could not save profile preferences"); });
        });
    }, [readyId, activeProfile?.id, switching]);

    const refresh = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: ["profiles", session?.user.id] });
    }, [queryClient, session?.user.id]);

    const switchProfile = async (id: string) => {
        if (switching || !query.data?.profiles.some((p) => p.id === id)) return;
        flushSync(() => setSwitching(true));
        try {
            await saving.current;
            await queryClient.cancelQueries({ predicate: (q) => perProfile.has(String(q.queryKey[0])) });
            await setActiveProfile(id);
            traktClient.reset();
            queryClient.removeQueries({ predicate: (q) => perProfile.has(String(q.queryKey[0])) });
            setReadyId(null);
            sessionStorage.setItem(`dui-profile-picked:${session?.user.id}`, id);
            queryClient.setQueryData<ProfileList>(queryKey, (old) => old ? { ...old, activeProfileId: id } : old);
        } finally {
            setSwitching(false);
        }
    };

    if (!session) return children;
    if (query.error || error) return <SplashErrorScreen title="Failed to Load Profiles" error={error ?? query.error!} onRetry={() => window.location.reload()} />;
    if (!activeProfile || switching || readyId !== activeProfile.id) return <SplashScreen stage="Loading profile..." />;
    return <ProfileContext.Provider value={{ profiles: query.data!.profiles, activeProfile, switchProfile, refresh }}>{children}</ProfileContext.Provider>;
}
