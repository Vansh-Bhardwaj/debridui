import type { DeviceClass } from "@/lib/device/detect";
import type { PlaybackSettings, StreamingSettings } from "@/lib/stores/settings";

export const settingsSections = [
    { id: "profile", label: "Profile" },
    { id: "playback", label: "Playback" },
    { id: "subtitles", label: "Subtitles" },
    { id: "streaming", label: "Streaming" },
    { id: "appearance", label: "Appearance" },
    { id: "accounts", label: "Accounts" },
    { id: "devices", label: "Devices" },
    { id: "data", label: "Data" },
    { id: "about", label: "About" },
] as const;
export type SettingsSection = (typeof settingsSections)[number]["id"];
export type SettingKey =
    | "deviceSync"
    | "tvMode"
    | `playback.${keyof PlaybackSettings}`
    | `streaming.${keyof StreamingSettings}`;
export type CustomControl =
    | "profiles"
    | "trakt"
    | "tmdb"
    | "quality"
    | "compatibility"
    | "player"
    | "theme"
    | "accounts"
    | "torbox"
    | "override"
    | "links-cache"
    | "all-cache"
    | "watch-history"
    | "search-history"
    | "failed-sources"
    | "build";
type Control =
    | { type: "switch"; key: SettingKey }
    | { type: "select"; key: SettingKey; options: readonly { value: string; label: string }[]; numeric?: boolean }
    | { type: "custom"; component: CustomControl };
export type SettingEntry = {
    id: string;
    section: SettingsSection;
    label: string;
    description?: string;
    devices: readonly DeviceClass[];
    scope: "profile" | "device" | "account";
    requires?: "torbox" | "trakt";
    control: Control;
};
const all: DeviceClass[] = ["phone", "tablet", "desktop", "tv"];
export const languageOptions =
    "english spanish french german italian portuguese russian japanese korean hindi arabic chinese dutch polish turkish swedish czech romanian greek thai vietnamese indonesian ukrainian norwegian danish finnish hebrew hungarian bulgarian croatian serbian malay slovak"
        .split(" ")
        .map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
const options = (values: (string | number)[], labels?: string[]) =>
    values.map((value, i) => ({ value: String(value), label: labels?.[i] ?? String(value) }));

export const settingsRegistry: readonly SettingEntry[] = [
    {
        id: "profiles",
        section: "profile",
        label: "Current profile",
        description: "Switch or manage profiles, names, avatars and colours",
        devices: all,
        scope: "profile",
        control: { type: "custom", component: "profiles" },
    },
    {
        id: "trakt",
        section: "profile",
        label: "Trakt",
        description: "Connect Trakt to scrobble playback and sync watchlist and calendar for this profile",
        devices: all,
        scope: "profile",
        control: { type: "custom", component: "trakt" },
    },
    {
        id: "auto-resume",
        section: "playback",
        label: "Auto-Resume",
        description: "Resume playback from where you left off",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "playback.autoResume" },
    },
    {
        id: "auto-next-episode",
        section: "playback",
        label: "Auto-Play Next Episode",
        description: "Automatically play the next episode when current one ends",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "playback.autoNextEpisode" },
    },
    {
        id: "auto-skip-intro",
        section: "playback",
        label: "Auto-Skip Intros",
        description: "Automatically skip intros, recaps and credits using community timestamps from IntroDB",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "playback.autoSkipIntro" },
    },
    {
        id: "playback-speed",
        section: "playback",
        label: "Playback Speed",
        description: "Default video playback speed",
        devices: all,
        scope: "profile",
        control: {
            type: "select",
            key: "playback.playbackSpeed",
            numeric: true,
            options: options(
                [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
                ["0.5x", "0.75x", "1.0x", "1.25x", "1.5x", "1.75x", "2.0x"]
            ),
        },
    },
    {
        id: "next-episode-prompt",
        section: "playback",
        label: "Next Episode Prompt",
        description: "Show the next episode overlay this many seconds before the episode ends",
        devices: all,
        scope: "profile",
        control: {
            type: "select",
            key: "playback.nextEpisodePromptSeconds",
            numeric: true,
            options: options([10, 20, 30, 45, 60, 90], ["10s", "20s", "30s", "45s", "60s", "90s"]),
        },
    },
    {
        id: "media-player",
        section: "playback",
        label: "Default Player",
        description: "External media player and setup instructions; requires the application to be installed",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "player" },
    },
    {
        id: "subtitle-auto-sync",
        section: "subtitles",
        label: "Auto-Sync Subtitles",
        description:
            "Listen to short audio clips on this device to fix subtitle delay and frame-rate drift. Works in Apple's player too",
        devices: all,
        scope: "device",
        control: { type: "switch", key: "playback.subtitleAutoSync" },
    },
    {
        id: "subtitle-language",
        section: "subtitles",
        label: "Subtitle Language",
        description: "Auto-select subtitles in this language",
        devices: all,
        scope: "profile",
        control: { type: "select", key: "playback.subtitleLanguage", options: languageOptions },
    },
    {
        id: "subtitle-size",
        section: "subtitles",
        label: "Subtitle Size",
        description: "Text size for subtitles",
        devices: all,
        scope: "profile",
        control: {
            type: "select",
            key: "playback.subtitleSize",
            numeric: true,
            options: options([16, 20, 24, 32, 40], ["Small", "Medium", "Default", "Large", "X-Large"]),
        },
    },
    {
        id: "subtitle-position",
        section: "subtitles",
        label: "Subtitle Position",
        description: "Vertical position of subtitles from the bottom",
        devices: all,
        scope: "profile",
        control: {
            type: "select",
            key: "playback.subtitlePosition",
            numeric: true,
            options: options([16, 32, 56, 80, 120], ["Very Low", "Low", "Default", "High", "Very High"]),
        },
    },
    {
        id: "quality-profile",
        section: "streaming",
        label: "Quality Profile",
        description: "Choose a quality profile or custom minimum and maximum resolution and source quality",
        devices: all,
        scope: "profile",
        control: { type: "custom", component: "quality" },
    },
    {
        id: "auto-play",
        section: "streaming",
        label: "Auto-play",
        description: "Automatically start playback when a cached source is found",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.autoPlay" },
    },
    {
        id: "prefer-cached",
        section: "streaming",
        label: "Prefer Cached Sources",
        description: "Prioritize cached sources even if lower quality is available",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.preferCached" },
    },
    {
        id: "allow-uncached",
        section: "streaming",
        label: "Allow Uncached Sources",
        description: "Automatically play uncached sources without confirmation",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.allowUncached" },
    },
    {
        id: "preferred-language",
        section: "streaming",
        label: "Preferred Language",
        description: "Prioritize sources matching this audio language",
        devices: all,
        scope: "profile",
        control: { type: "select", key: "streaming.preferredLanguage", options: languageOptions },
    },
    {
        id: "compatibility",
        section: "playback",
        label: "Browser Playback",
        description:
            "Playback compatibility: Auto, Original file, Compatible stream or On this device; browser codec support",
        devices: all,
        scope: "profile",
        control: { type: "custom", component: "compatibility" },
    },
    {
        id: "lock-source",
        section: "streaming",
        label: "Keep Source Once Playing",
        description: "If a stream drops mid-playback, reconnect to the same file instead of switching releases",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.lockSourceAfterStart" },
    },
    {
        id: "skip-cam",
        section: "streaming",
        label: "Skip Cam Releases",
        description: "Rank CAM, telesync and screener rips last",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.skipCamReleases" },
    },
    {
        id: "remember-failed",
        section: "streaming",
        label: "Remember Failed Sources",
        description: "Sources that failed or were placeholder files rank last on this device for 7 days",
        devices: all,
        scope: "profile",
        control: { type: "switch", key: "streaming.rememberFailedSources" },
    },
    {
        id: "failed-sources",
        section: "data",
        label: "Failed-source Memory",
        description: "Clear remembered failed sources on this device",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "failed-sources" },
    },
    {
        id: "theme",
        section: "appearance",
        label: "Theme",
        description: "Select your preferred color scheme for the interface",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "theme" },
    },
    {
        id: "accounts",
        section: "accounts",
        label: "Debrid Accounts",
        description: "Manage the family's debrid accounts",
        devices: all,
        scope: "account",
        control: { type: "custom", component: "accounts" },
    },
    {
        id: "tmdb",
        section: "accounts",
        label: "TMDB",
        description: "API key for episode grouping for TV shows",
        devices: all,
        scope: "account",
        control: { type: "custom", component: "tmdb" },
    },
    {
        id: "torbox",
        section: "accounts",
        label: "TorBox",
        description: "Account dashboard coming soon",
        devices: all,
        scope: "account",
        requires: "torbox",
        control: { type: "custom", component: "torbox" },
    },
    {
        id: "device-sync",
        section: "devices",
        label: "Device Sync",
        description: "Sync playback state and controls across your devices in real-time",
        devices: all,
        scope: "device",
        control: { type: "switch", key: "deviceSync" },
    },
    {
        id: "tv-mode",
        section: "devices",
        label: "Big Picture Mode",
        description:
            "Fullscreen 10-foot UI for TVs: large cards, arrow-key and controller navigation (⇧T or the Guide button)",
        devices: ["desktop"],
        scope: "device",
        control: { type: "switch", key: "tvMode" },
    },
    {
        id: "device-override",
        section: "devices",
        label: "Device Interface",
        description: "Automatically detect this device or choose an interface",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "override" },
    },
    {
        id: "links-cache",
        section: "data",
        label: "Download Links Cache",
        description: "Remove all cached download links",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "links-cache" },
    },
    {
        id: "all-cache",
        section: "data",
        label: "All Cached Data",
        description: "Remove all cached data from browser",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "all-cache" },
    },
    {
        id: "watch-history",
        section: "data",
        label: "Watch History",
        description: "Remove all server-side watch history entries for this profile",
        devices: all,
        scope: "profile",
        control: { type: "custom", component: "watch-history" },
    },
    {
        id: "search-history",
        section: "data",
        label: "Search History",
        description: "Remove recent search suggestions stored in your browser",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "search-history" },
    },
    {
        id: "build",
        section: "about",
        label: "Last Updated",
        description: "Application build time",
        devices: all,
        scope: "device",
        control: { type: "custom", component: "build" },
    },
];

export type SettingsContext = { device: DeviceClass; isTorbox: boolean; isTraktConnected: boolean };
export function filterSettings(context: SettingsContext, search = "", entries = settingsRegistry) {
    const query = search.trim().toLowerCase();
    return entries.filter(
        (entry) =>
            entry.devices.includes(context.device) &&
            (!entry.requires || (entry.requires === "torbox" ? context.isTorbox : context.isTraktConnected)) &&
            (!query || `${entry.label} ${entry.description ?? ""}`.toLowerCase().includes(query))
    );
}
