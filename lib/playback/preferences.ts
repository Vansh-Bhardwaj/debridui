import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { migratePlaybackMode, type PlaybackEngine, type PlaybackMode } from "@/lib/utils/codec-support";
import type { StreamingSettings } from "@/lib/stores/settings";
import type { DeviceProfile } from "./device-profile";

export const usePlaybackOverride = create<{ mode: PlaybackMode | null; setMode: (mode: PlaybackMode | null) => void }>()(
    persist((set) => ({ mode: null, setMode: (mode) => set({ mode }) }), {
        name: "dui-playback-mode-override",
        storage: createJSONStorage(() => localStorage),
    })
);

export function playbackEngine(settings: StreamingSettings, override = usePlaybackOverride.getState().mode): PlaybackEngine {
    const mode = override ?? migratePlaybackMode(settings.playbackEngine);
    return mode === "fallback" && settings.deviceAudioRemux ? "device" : mode;
}

export function playbackRankingOptions(engine: PlaybackEngine, profile: DeviceProfile | null, available: boolean) {
    const converted = engine === "transcode" || (engine !== "native" && profile?.route === "native" && available);
    return {
        codecSupport: converted ? undefined : profile?.codecs,
        mkvPlayable: converted || (profile?.mkv ?? true),
        transcodeAvailable: converted && available,
        transcodeOnly: engine === "transcode",
    };
}
