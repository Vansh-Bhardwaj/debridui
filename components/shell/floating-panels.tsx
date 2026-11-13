"use client";

import { useDevice } from "@/components/device/device-provider";
import { RemoteControlBanner } from "@/components/device-sync/remote-banner";
import { VLCMiniPlayer } from "@/components/vlc/vlc-mini-player";
import { cn } from "@/lib/utils";

export function FloatingPanels({ tvMode }: { tvMode: boolean }) {
    const { isPhone, isTablet } = useDevice();
    const hasTabs = !tvMode && (isPhone || isTablet);
    return (
        <div className={cn(
            "fixed inset-x-0 z-40 pointer-events-none flex flex-col items-stretch",
            hasTabs ? "bottom-[calc(4rem+env(safe-area-inset-bottom))]" : "bottom-0 pb-[env(safe-area-inset-bottom)]",
            !tvMode && isTablet && "landscape:bottom-0 landscape:pb-[env(safe-area-inset-bottom)] landscape:left-[calc(4rem+env(safe-area-inset-left))]"
        )}>
            <VLCMiniPlayer />
            <RemoteControlBanner />
        </div>
    );
}
