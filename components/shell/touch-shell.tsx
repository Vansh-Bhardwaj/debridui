"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, FolderOpen, Home, Search } from "reicon-react";
import { Breadcrumbs } from "@/components/common/breadcrumbs";
import { SearchButton } from "@/components/common/search-button";
import { RouteTransition } from "@/components/common/route-transition";
import { ControlledIndicator } from "@/components/device-sync/controlled-indicator";
import { browseNav, manageNav } from "@/components/sidebar/app-sidebar";
import { cn } from "@/lib/utils";
import { YouMenu } from "./you-menu";

const tabs = [
    { title: "Home", url: "/dashboard", icon: Home },
    { title: "Search", url: "/search", icon: Search },
    { title: "My List", url: "/watchlist", icon: Bookmark },
    { title: "Files", url: "/files", icon: FolderOpen },
];

export function TouchShell({ children, tablet = false }: { children: React.ReactNode; tablet?: boolean }) {
    const pathname = usePathname();
    const active = (url: string) => pathname === url || pathname.startsWith(url + "/");
    // --bottom-nav lets page-level bottom bars (file actions, bulk actions) sit above the tab bar.
    return (
        <div className={cn("min-h-svh bg-background [--bottom-nav:calc(4rem+env(safe-area-inset-bottom))]", tablet && "landscape:pl-[calc(4rem+env(safe-area-inset-left))] landscape:[--bottom-nav:0px]")}>
            {tablet && (
                <aside aria-label="Main navigation" className="fixed inset-y-0 left-0 z-40 hidden w-[calc(4rem+env(safe-area-inset-left))] flex-col items-center overflow-y-auto border-r border-border/50 bg-muted/30 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] landscape:flex">
                    <span className="sr-only">Browse · Library &amp; Setup</span>
                    {[...browseNav, ...manageNav].map(({ title, url, icon: Icon }) => (
                        <Link key={url} href={url} aria-label={title} title={title} aria-current={active(url) ? "page" : undefined} className={cn("flex min-h-phone-touch min-w-phone-touch shrink-0 items-center justify-center hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring", active(url) ? "text-primary bg-muted/30" : "text-muted-foreground")}>
                            <Icon weight={active(url) ? "Filled" : "Outline"} className="size-5" />
                        </Link>
                    ))}
                    <div className="mt-auto"><YouMenu iconOnly /></div>
                </aside>
            )}
            <ControlledIndicator />
            <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-3 border-b border-border/50 bg-background/95 pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
                <Breadcrumbs compact />
                <SearchButton className="min-h-phone-touch min-w-phone-touch shrink-0" />
            </header>
            <main id="main-content" tabIndex={-1} className={cn("outline-none pb-[calc(5rem+env(safe-area-inset-bottom))]", tablet && "landscape:pb-[env(safe-area-inset-bottom)]")}>
                <RouteTransition>
                    <div className="flex min-w-0 flex-col gap-4 pt-6 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">{children}</div>
                </RouteTransition>
            </main>
            <nav aria-label="Main navigation" className={cn("fixed inset-x-0 bottom-0 z-40 flex border-t border-border/50 bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]", tablet && "landscape:hidden")}>
                {tabs.map(({ title, url, icon: Icon }) => (
                    <Link key={url} href={url} aria-current={active(url) ? "page" : undefined} className={cn("flex h-16 min-h-phone-touch min-w-phone-touch flex-1 flex-col items-center justify-center gap-1 text-xs hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring", active(url) ? "text-primary bg-muted/30" : "text-muted-foreground")}>
                        <Icon weight={active(url) ? "Filled" : "Outline"} className="size-5" /><span>{title}</span>
                    </Link>
                ))}
                <YouMenu />
            </nav>
        </div>
    );
}
