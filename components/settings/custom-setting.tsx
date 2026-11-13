"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { format, formatDistanceToNow } from "date-fns";
import { useDevice } from "@/components/device/device-provider";
import { ProfileSwitcher } from "@/components/profiles/profile-switcher";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/lib/stores/settings";
import type { CustomControl, SettingEntry } from "@/lib/settings/registry";
import { DEVICE_OVERRIDE_KEY, isDeviceClass } from "@/lib/device/detect";
import { PlaybackCompatibility } from "./playback-compatibility";
import { IntegrationControl } from "./integrations";
import { QualityProfile } from "./quality-profile";
import { DataControl } from "./data-control";
import { MediaPlayerControl } from "./media-player-control";
import { SettingRow, SettingsSelect } from "./setting-row";

const TorBoxAccount = dynamic(() => import("./torbox-account"));

const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || new Date().toISOString();
const noopSubscribe = () => () => {};

function DeviceOverride() {
    const { device, setOverride } = useDevice();
    const [choice, setChoice] = useState(() =>
        typeof window === "undefined" ? "auto" : (localStorage.getItem(DEVICE_OVERRIDE_KEY) ?? "auto")
    );
    return (
        <div className="space-y-2">
            <SettingsSelect
                id="device-override"
                label="Device Interface"
                value={choice}
                options={[
                    { value: "auto", label: "Automatic" },
                    ...["phone", "tablet", "desktop", "tv"].map((value) => ({
                        value,
                        label: value === "tv" ? "TV" : value[0].toUpperCase() + value.slice(1),
                    })),
                ]}
                onChange={(value) => {
                    setChoice(value);
                    setOverride(isDeviceClass(value) ? value : null);
                }}
            />
            <p className="text-xs text-muted-foreground">Current interface: {device}</p>
        </div>
    );
}

function ThemeControl() {
    const { theme, setTheme } = useTheme();
    return (
        <SettingsSelect
            id="theme"
            label="Theme"
            value={theme ?? "system"}
            onChange={setTheme}
            options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
            ]}
        />
    );
}

function BuildInfo() {
    const mounted = useSyncExternalStore(
        noopSubscribe,
        () => true,
        () => false
    );
    const date = new Date(BUILD_TIME);
    return (
        <p className="text-sm text-muted-foreground">
            {mounted ? (
                <>
                    {formatDistanceToNow(date, { addSuffix: true })} · {format(date, "PPpp")}
                </>
            ) : (
                BUILD_TIME
            )}
        </p>
    );
}

export function CustomSetting({ entry, component }: { entry: SettingEntry; component: CustomControl }) {
    const { get, set } = useSettingsStore();
    if (component === "trakt" || component === "tmdb") return <IntegrationControl kind={component} />;
    if (component === "quality") return <QualityProfile />;
    if (component === "compatibility")
        return (
            <PlaybackCompatibility
                streaming={get("streaming")}
                updateStreaming={(updates) => set("streaming", { ...get("streaming"), ...updates })}
            />
        );
    if (component === "player") return <MediaPlayerControl entry={entry} />;
    if (["links-cache", "all-cache", "watch-history", "search-history", "failed-sources"].includes(component))
        return <DataControl entry={entry} kind={component} />;
    return (
        <SettingRow entry={entry}>
            {component === "profiles" && (
                <div className="flex flex-wrap items-center gap-3">
                    <ProfileSwitcher />
                    <Button asChild variant="outline" className="min-h-phone-touch">
                        <Link href="/profiles?manage=1" data-tv-focusable>
                            Manage profiles
                        </Link>
                    </Button>
                </div>
            )}
            {component === "theme" && <ThemeControl />}
            {component === "accounts" && (
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" className="min-h-phone-touch">
                        <Link href="/accounts" data-tv-focusable>
                            Manage accounts
                        </Link>
                    </Button>
                    <Button asChild variant="outline" className="min-h-phone-touch">
                        <Link href="/settings/account" data-tv-focusable>
                            Account security
                        </Link>
                    </Button>
                </div>
            )}
            {component === "torbox" && (
                <TorBoxAccount />
            )}
            {component === "override" && <DeviceOverride />}
            {component === "build" && <BuildInfo />}
        </SettingRow>
    );
}
