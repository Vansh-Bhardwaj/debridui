"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SearchProvider } from "@/components/mdb/search-provider";
import { PreviewDialog } from "@/components/preview/preview-dialog";
import { SourcePickerSheet } from "@/components/mdb/source-picker";
import { DeviceSyncReporter } from "@/components/device-sync/device-sync-reporter";
import { ControlledIndicator } from "@/components/device-sync/controlled-indicator";
import { BrowseHandler } from "@/components/device-sync/browse-handler";
import { initDeviceSync } from "@/lib/stores/device-sync";
import { useAuth } from "@/components/auth/auth-provider";
import { SplashScreen } from "@/components/auth/splash-screen";
import { PreviewRegistryLoader } from "@/components/preview/registry-loader";
import { KeyboardShortcutsDialog } from "@/components/common/keyboard-shortcuts-dialog";
import { RouteTransition } from "@/components/common/route-transition";
import { TVNavigationBar } from "@/components/tv/tv-navigation";
import { GamepadHints } from "@/components/tv/gamepad-hints";
import { BigPictureSession } from "@/components/tv/big-picture-session";
import { TVCursor } from "@/components/tv/tv-cursor";
import { useTVMode } from "@/hooks/use-tv-mode";
import { useTVFocus } from "@/hooks/use-tv-focus";
import { useDevice } from "@/components/device/device-provider";
import { TouchShell } from "@/components/shell/touch-shell";
import { DesktopShell } from "@/components/shell/desktop-shell";
import { FloatingPanels } from "@/components/shell/floating-panels";
import { useUserSettings } from "@/hooks/use-user-settings";


// TV mode layout — no sidebar, top nav bar
function TVLayout({ children }: { children: React.ReactNode }) {
    const { cursor } = useTVFocus();

    return (
        <div className="min-h-screen bg-background">
            <TVNavigationBar />
            <ControlledIndicator />
            <main id="main-content" tabIndex={-1} className="pt-16 outline-none">
                <RouteTransition>
                    <div className="flex flex-1 flex-col gap-4 p-4 px-8 pt-6 xl:px-12 2xl:px-16">
                        {children}
                    </div>
                </RouteTransition>
            </main>
            <GamepadHints />
            <BigPictureSession />
            <TVCursor x={cursor.x} y={cursor.y} visible={cursor.visible} hovering={cursor.hovering} targetRect={cursor.targetRect} />
        </div>
    );
}

function DeviceFrame({ children, tvMode }: { children: React.ReactNode; tvMode: boolean }) {
    const { device } = useDevice();
    if (tvMode) return <TVLayout>{children}</TVLayout>;
    if (device === "phone") return <TouchShell>{children}</TouchShell>;
    if (device === "tablet") return <TouchShell tablet>{children}</TouchShell>;
    return <DesktopShell>{children}</DesktopShell>;
}

const subscribeHydration = () => () => {};

// Visually-hidden until focused — lets keyboard users jump past nav to content.
function SkipToContent() {
    return (
        <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-sm focus:border focus:border-border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring">
            Skip to content
        </a>
    );
}

// App layout - requires at least one account
// Redirect logic is centralized in AuthProvider
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { userAccounts, currentAccount, currentUser, client } = useAuth();
    const { tvMode } = useTVMode();
    const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
    useUserSettings();

    // Initialize device sync once on mount (reads setting from Zustand)
    useEffect(() => { initDeviceSync(); }, []);

    // Single check for all required data to prevent flicker
    // AuthProvider handles redirect to /onboarding if no accounts
    const isReady = userAccounts.length > 0 && currentAccount && currentUser && client;
    if (!hydrated || !isReady) {
        return <SplashScreen stage="Starting up…" />;
    }

    return (
        <KeyboardShortcutsDialog>
            <SearchProvider>
                <SkipToContent />
                <div id="tv-mode-root" {...(tvMode ? { "data-tv-mode": "" } : {})}>
                    <DeviceFrame tvMode={tvMode}>{children}</DeviceFrame>
                </div>
                <PreviewDialog />
                <SourcePickerSheet />
                <PreviewRegistryLoader />
                <FloatingPanels tvMode={tvMode} />
                <DeviceSyncReporter />
                <BrowseHandler />
            </SearchProvider>
        </KeyboardShortcutsDialog>
    );
}
