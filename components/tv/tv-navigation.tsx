"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    HomeIcon,
    SearchIcon,
    FolderOpen,
    Bookmark,
    History,
    SettingsIcon,
    Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTVMode } from "@/hooks/use-tv-mode";
import { useSearch } from "@/components/mdb/search-provider";
import { Button } from "@/components/ui/button";
import { usePreviewStore } from "@/lib/stores/preview";

const tvNavItems = [
    { title: "Home", url: "/dashboard", icon: HomeIcon },
    { title: "Search", url: "/search", icon: SearchIcon, action: "search" },
    { title: "Watchlist", url: "/watchlist", icon: Bookmark },
    { title: "History", url: "/history", icon: History },
    { title: "Files", url: "/files", icon: FolderOpen },
    { title: "Settings", url: "/settings", icon: SettingsIcon },
];

export const TVNavigationBar = memo(function TVNavigationBar() {
    const { tvMode, toggle } = useTVMode();
    const pathname = usePathname();
    const router = useRouter();
    const { toggle: toggleSearch } = useSearch();
    const previewOpen = usePreviewStore((s) => s.isOpen);
    const [clock, setClock] = useState("");

    useEffect(() => {
        if (!tvMode) return;
        const update = () =>
            setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        update();
        const id = setInterval(update, 30_000);
        return () => clearInterval(id);
    }, [tvMode]);

    const handleNav = useCallback(
        (item: (typeof tvNavItems)[number]) => {
            if (item.action === "search") {
                toggleSearch();
            } else {
                router.push(item.url);
            }
        },
        [router, toggleSearch]
    );

    if (!tvMode || previewOpen) return null;

    return (
        <nav className="tv-nav-bar fixed top-0 inset-x-0 z-[60] flex items-center justify-between h-16 px-6 bg-background/80 backdrop-blur-xl border-b border-border/30">
            {/* Brand */}
            <span className="text-xs tracking-widest uppercase text-muted-foreground">
                DebridUI
            </span>

            {/* Nav items */}
            <div className="flex items-center gap-1" data-tv-section="nav">
                {tvNavItems.map((item) => {
                    const isActive = pathname === item.url || pathname.startsWith(item.url + "/");
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.url}
                            onClick={() => handleNav(item)}
                            data-tv-focusable
                            data-active={isActive || undefined}
                            className={cn(
                                "tv-nav-item relative flex items-center gap-2 px-4 py-2 rounded-sm text-sm transition-colors",
                                isActive
                                    ? "text-primary"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                            )}
                        >
                            <Icon className="size-4" />
                            <span>{item.title}</span>
                        </button>
                    );
                })}
            </div>

            {/* Clock + Exit */}
            <div className="flex items-center gap-4">
                {clock && (
                    <span className="tv-clock text-sm text-muted-foreground/60 font-light">
                        {clock}
                    </span>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    onClick={toggle}
                    data-tv-focusable
                    className="text-muted-foreground"
                >
                    <Monitor className="size-4" />
                    Exit
                </Button>
            </div>
        </nav>
    );
});
