"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useProfile } from "@/hooks/use-profile";
import { useSettingsStore } from "@/lib/stores/settings";
import {
    useUserSettings,
    useSaveUserSettings,
    useDisconnectTrakt,
    hydrateSettingsFromServer,
} from "@/hooks/use-user-settings";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function TraktOAuthFeedback() {
    const {
        activeProfile: { id: profileId },
    } = useProfile();
    const searchParams = useSearchParams();
    const router = useRouter();
    useEffect(() => {
        const traktParam = searchParams.get("trakt");
        if (!traktParam) return;
        if (traktParam === "connected") {
            toast.success("Trakt connected successfully");
            queryClient.invalidateQueries({ queryKey: ["user-settings", profileId] });
        } else if (traktParam === "error") {
            const reason = searchParams.get("reason");
            const messages: Record<string, string> = {
                no_code: "No authorization code received from Trakt",
                config: "Trakt client ID or secret not configured on server",
                exchange: "Failed to exchange authorization code with Trakt",
                state_mismatch: "Security validation failed — please try connecting again",
            };
            toast.error(messages[reason ?? ""] || "Failed to connect Trakt");
        }
        // Clean up query params from URL
        router.replace("/settings/profile", { scroll: false });
    }, [searchParams, router, profileId]);
    return null;
}

export function OAuthFeedback() {
    return (
        <Suspense>
            <TraktOAuthFeedback />
        </Suspense>
    );
}

function TraktControl() {
    const { data: serverSettings } = useUserSettings();
    const { mutate: disconnectTrakt, isPending } = useDisconnectTrakt();
    const connected = !!serverSettings?.trakt_access_token;
    return (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-border/50 bg-muted/30 p-4">
            <div className="space-y-1">
                <p className="text-sm">Trakt {connected && <span className="text-secondary">· Connected</span>}</p>
                <p className="text-xs text-muted-foreground">
                    {connected
                        ? "Scrobbling, watchlist & calendar synced to your profile"
                        : "Scrobble playback, sync watchlist & calendar"}
                </p>
                <p className="text-xs tracking-widest uppercase text-muted-foreground">Profile</p>
            </div>
            <Button
                data-tv-focusable
                className="min-h-phone-touch"
                variant={connected ? "outline" : "default"}
                disabled={isPending}
                onClick={() => {
                    if (connected) disconnectTrakt();
                    else window.location.href = "/api/trakt/authorize";
                }}>
                {connected ? "Disconnect" : "Connect"}
            </Button>
        </div>
    );
}

function TmdbControl() {
    const { get, set } = useSettingsStore();
    const { data: serverSettings } = useUserSettings();
    const { mutate: saveSettings } = useSaveUserSettings();
    const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pending = useRef<string | null>(null);
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
    useEffect(() => {
        hydrateSettingsFromServer(serverSettings ?? null);
    }, [serverSettings]);
    useEffect(
        () => () => {
            if (timeout.current) clearTimeout(timeout.current);
            // Section navigation must not drop a pending account-wide key update.
            if (pending.current !== null) saveSettings({ tmdb_api_key: pending.current || undefined });
        },
        [saveSettings]
    );
    const change = (value: string) => {
        set("tmdbApiKey", value);
        pending.current = value;
        setSaveState("saving");
        if (timeout.current) clearTimeout(timeout.current);
        timeout.current = setTimeout(() => {
            pending.current = null;
            saveSettings(
                { tmdb_api_key: value || undefined },
                {
                    onSuccess: () => {
                        setSaveState("saved");
                        timeout.current = setTimeout(() => setSaveState("idle"), 1500);
                    },
                    onError: () => setSaveState("error"),
                }
            );
        }, 600);
    };
    return (
        <div className="space-y-3 border border-border/50 bg-muted/30 p-4">
            <div className="space-y-1">
                <Label htmlFor="tmdb-api-key" className="text-sm">
                    TMDB
                </Label>
                <p className="text-xs text-muted-foreground">Episode grouping for TV shows.</p>
                <p className="text-xs tracking-widest uppercase text-muted-foreground">Account</p>
                <a
                    data-tv-focusable
                    href="https://www.themoviedb.org/settings/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-phone-touch items-center text-xs underline hover:text-primary">
                    Get a free key
                </a>
            </div>
            <Input
                id="tmdb-api-key"
                data-tv-focusable
                type="password"
                placeholder="Enter your TMDB API key"
                value={get("tmdbApiKey")}
                onChange={(event) => change(event.target.value)}
                className="min-h-phone-touch max-w-md"
            />
            {saveState !== "idle" && (
                <p
                    role="status"
                    className={cn(
                        "text-xs tracking-wide uppercase",
                        saveState === "error" ? "text-destructive" : "text-muted-foreground"
                    )}>
                    {saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "Save failed"}
                </p>
            )}
        </div>
    );
}

export function IntegrationControl({ kind }: { kind: "trakt" | "tmdb" }) {
    return kind === "trakt" ? <TraktControl /> : <TmdbControl />;
}
