"use client";

import { useSettingsStore } from "@/lib/stores/settings";
import { useDevice } from "@/components/device/device-provider";
import { detectPlatform, PLAYER_PLATFORM_SUPPORT } from "@/lib/utils/media-player";
import { MediaPlayer, Platform } from "@/lib/types";
import type { SettingEntry } from "@/lib/settings/registry";
import { getPlayerSetupInstruction } from "@/app/(auth)/(app)/settings/player-setup-instructions";
import { SettingsSelect, SettingRow } from "./setting-row";

export function MediaPlayerControl({ entry }: { entry: SettingEntry }) {
    const { device } = useDevice();
    const { get, set, getPresets } = useSettingsStore();
    const platform = detectPlatform();
    const presets = (getPresets("mediaPlayer") ?? []).filter((preset) => {
        if (device === "tv" && platform !== Platform.ANDROID) return preset.value === MediaPlayer.BROWSER;
        const platforms = PLAYER_PLATFORM_SUPPORT[preset.value];
        if (platform !== Platform.UNKNOWN) return platforms.includes(platform);
        const candidates =
            device === "phone" || device === "tablet" || device === "tv"
                ? [Platform.ANDROID, Platform.IOS]
                : [Platform.WINDOWS, Platform.MACOS, Platform.LINUX];
        return candidates.some((candidate) => platforms.includes(candidate));
    });
    const player = get("mediaPlayer");
    const supported = presets.some((preset) => preset.value === player);
    const instruction = supported ? getPlayerSetupInstruction(player, platform) : null;
    return (
        <div className="space-y-3">
            <SettingRow entry={entry}>
                <SettingsSelect
                    id={entry.id}
                    label={entry.label}
                    value={supported ? player : ""}
                    onChange={(value) => set("mediaPlayer", value as MediaPlayer)}
                    options={presets}
                />
            </SettingRow>
            {!supported && (
                <p className="text-xs text-muted-foreground">
                    Choose a player for this platform. Your saved player is {player}.
                </p>
            )}
            {instruction && (
                <div
                    data-tv-section="player-setup"
                    className="border border-border/50 p-4 text-xs text-muted-foreground">
                    {instruction}
                </div>
            )}
        </div>
    );
}
