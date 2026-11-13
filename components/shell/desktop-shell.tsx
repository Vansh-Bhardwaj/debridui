"use client";

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { SearchButton } from "@/components/common/search-button";
import { DevicePicker } from "@/components/device-sync/device-picker";
import { ControlledIndicator } from "@/components/device-sync/controlled-indicator";
import { useKeyboardShortcuts } from "@/components/common/keyboard-shortcuts-dialog";
import { RouteTransition } from "@/components/common/route-transition";
import { AmbientHeaderSpark } from "@/components/motion/ambient-header-spark";
import { Keyboard, Tv } from "lucide-react";
import { useTVMode } from "@/hooks/use-tv-mode";

// Header keyboard shortcuts button
function ShortcutsButton() {
    const { open } = useKeyboardShortcuts();
    return (
        <button
            onClick={open}
            className="size-8 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[color,background-color,transform] duration-200 ease-premium hover:scale-105 active:scale-95 motion-reduce:transition-colors motion-reduce:hover:scale-100 motion-reduce:active:scale-100 shrink-0"
            aria-label="Keyboard shortcuts">
            <Keyboard className="size-4" />
        </button>
    );
}

function BigPictureButton() {
    const { toggle } = useTVMode();
    return (
        <button
            onClick={toggle}
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[color,background-color,transform] duration-200 ease-premium hover:scale-105 active:scale-95 motion-reduce:transition-colors motion-reduce:hover:scale-100 motion-reduce:active:scale-100 shrink-0"
            aria-label="Enter Big Picture mode"
            title="Big Picture (⇧T)">
            <Tv className="size-4" />
        </button>
    );
}

// Standard layout with sidebar
export function DesktopShell({ children }: { children: React.ReactNode }) {
    return (
        <SidebarProvider>
            <AppSidebar />
            {/* overflow-x-clip (not hidden): hidden makes this a scroll container and breaks the sticky header. */}
            <SidebarInset className="min-w-0 overflow-x-clip">
                <ControlledIndicator />
                {/* Home-screen app: the page draws under the status bar, so the bar sits below it and stays reachable. */}
                <header className="sticky top-0 flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 z-50 items-center justify-between gap-4 border-b border-border/50 bg-background/90 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-[calc(3rem+env(safe-area-inset-top))]">
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                        <SidebarTrigger className="-ml-1 shrink-0" />
                        <Separator orientation="vertical" className="h-4" />
                        <AmbientHeaderSpark />
                        <Breadcrumbs />
                    </div>
                    <div className="flex items-center gap-1">
                        <DevicePicker />
                        <BigPictureButton />
                        <ShortcutsButton />
                        <SearchButton className="shrink-0" />
                    </div>
                </header>
                <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
                    <RouteTransition>
                        <div className="flex flex-1 flex-col gap-4 p-4 pt-6">{children}</div>
                    </RouteTransition>
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
}

