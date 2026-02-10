"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { SearchButton } from "@/components/common/search-button";
import { SearchProvider } from "@/components/mdb/search-provider";
import { PreviewDialog } from "@/components/preview/preview-dialog";
import { VLCMiniPlayer } from "@/components/vlc-mini-player";
import { useAuth } from "@/components/auth/auth-provider";
import { SplashScreen } from "@/components/splash-screen";
import { PreviewRegistryLoader } from "@/components/preview/registry-loader";
import { KeyboardShortcutsDialog, useKeyboardShortcuts } from "@/components/keyboard-shortcuts-dialog";


// Header keyboard shortcuts button
function ShortcutsButton() {
    const { open } = useKeyboardShortcuts();
    return (
        <button
            onClick={open}
            className="size-8 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
            aria-label="Keyboard shortcuts">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
            </svg>
        </button>
    );
}

// App layout - requires at least one account
// Redirect logic is centralized in AuthProvider
export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { userAccounts, currentAccount, currentUser, client } = useAuth();

    // Single check for all required data to prevent flicker
    // AuthProvider handles redirect to /onboarding if no accounts
    const isReady = userAccounts.length > 0 && currentAccount && currentUser && client;
    if (!isReady) {
        return <SplashScreen />;
    }

    return (
        <KeyboardShortcutsDialog>
            <SearchProvider>
                <SidebarProvider>
                    <AppSidebar />
                    <SidebarInset className="overflow-x-hidden">
                        <header className="flex h-12 shrink-0 z-50 items-center justify-between gap-4 border-b border-border/30 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                            <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                                <SidebarTrigger className="-ml-1 shrink-0" />
                                <Breadcrumbs />
                            </div>
                            <div className="flex items-center gap-1">
                                <ShortcutsButton />
                                <SearchButton className="shrink-0" />
                            </div>
                        </header>
                        <div className="flex flex-1 flex-col gap-4 p-4 pt-6">{children}</div>
                    </SidebarInset>
                </SidebarProvider>
                <PreviewDialog />
                <PreviewRegistryLoader />
                <VLCMiniPlayer />
            </SearchProvider>
        </KeyboardShortcutsDialog>
    );
}
