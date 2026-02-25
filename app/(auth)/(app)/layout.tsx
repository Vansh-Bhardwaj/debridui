"use client";

import { useEffect } from "react";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { SearchButton } from "@/components/common/search-button";
import { SearchProvider } from "@/components/mdb/search-provider";
import { PreviewDialog } from "@/components/preview/preview-dialog";
import { SourcePickerSheet } from "@/components/mdb/source-picker";
import { VLCMiniPlayer } from "@/components/vlc/vlc-mini-player";
import { DevicePicker } from "@/components/device-sync/device-picker";
import { RemoteControlBanner } from "@/components/device-sync/remote-banner";
import { DeviceSyncReporter } from "@/components/device-sync/device-sync-reporter";
import { ControlledIndicator } from "@/components/device-sync/controlled-indicator";
import { BrowseHandler } from "@/components/device-sync/browse-handler";
import { initDeviceSync } from "@/lib/stores/device-sync";
import { useAuth } from "@/components/auth/auth-provider";
import { SplashScreen } from "@/components/auth/splash-screen";
import { PreviewRegistryLoader } from "@/components/preview/registry-loader";
import { KeyboardShortcutsDialog, useKeyboardShortcuts } from "@/components/common/keyboard-shortcuts-dialog";
import { RouteTransition } from "@/components/common/route-transition";
import { Keyboard } from "lucide-react";
import { TVNavigationBar } from "@/components/tv/tv-navigation";
import { GamepadHints } from "@/components/tv/gamepad-hints";
import { TVCursor } from "@/components/tv/tv-cursor";
import { useTVMode } from "@/hooks/use-tv-mode";
import { useTVFocus } from "@/hooks/use-tv-focus";


// Header keyboard shortcuts button
function ShortcutsButton() {
    const { open } = useKeyboardShortcuts();
    return (
        <button
            onClick={open}
            className="size-8 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            aria-label="Keyboard shortcuts">
            <Keyboard className="size-4" />
        </button>
    );
}

// Standard layout with sidebar
function StandardLayout({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset className="overflow-x-hidden">
                <ControlledIndicator />
                <header className="flex h-12 shrink-0 z-50 items-center justify-between gap-4 border-b border-border/30 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="h-4" />
                        <Breadcrumbs />
                    </div>
                    <div className="flex items-center gap-1">
                        <DevicePicker />
                        <ShortcutsButton />
                        <SearchButton className="shrink-0" />
                    </div>
                </header>
                <RouteTransition>
                    <div className="flex flex-1 flex-col gap-4 p-4 pt-6">{children}</div>
                </RouteTransition>
            </SidebarInset>
        </SidebarProvider>
    );
}

// TV mode layout — no sidebar, top nav bar
function TVLayout({ children }: { children: React.ReactNode }) {
    const { cursor } = useTVFocus();

    return (
        <div className="min-h-screen bg-background">
            <TVNavigationBar />
            <ControlledIndicator />
            <main className="pt-16">
                <RouteTransition>
                    <div className="flex flex-1 flex-col gap-4 p-4 px-8 pt-6 xl:px-12 2xl:px-16">
                        {children}
                    </div>
                </RouteTransition>
            </main>
            <GamepadHints />
            <TVCursor x={cursor.x} y={cursor.y} visible={cursor.visible} hovering={cursor.hovering} targetRect={cursor.targetRect} />
        </div>
    );
}

// App layout - requires at least one account
// Redirect logic is centralized in AuthProvider
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { userAccounts, currentAccount, currentUser, client } = useAuth();
    const { tvMode } = useTVMode();

    // Initialize device sync once on mount (reads setting from Zustand)
    useEffect(() => { initDeviceSync(); }, []);

    // Single check for all required data to prevent flicker
    // AuthProvider handles redirect to /onboarding if no accounts
    const isReady = userAccounts.length > 0 && currentAccount && currentUser && client;
    if (!isReady) {
        return <SplashScreen />;
    }

    return (
        <KeyboardShortcutsDialog>
            <SearchProvider>
                <div id="tv-mode-root" {...(tvMode ? { "data-tv-mode": "" } : {})}>
                    {tvMode ? (
                        <TVLayout>{children}</TVLayout>
                    ) : (
                        <StandardLayout>{children}</StandardLayout>
                    )}
                </div>
                <PreviewDialog />
                <SourcePickerSheet />
                <PreviewRegistryLoader />
                {/* Bottom floating panels — stacked vertically to avoid overlap */}
                <div className="fixed bottom-0 inset-x-0 z-50 pointer-events-none flex flex-col items-stretch pb-[env(safe-area-inset-bottom)]">
                    <VLCMiniPlayer />
                    <RemoteControlBanner />
                </div>
                <DeviceSyncReporter />
                <BrowseHandler />
            </SearchProvider>
        </KeyboardShortcutsDialog>
    );
}
