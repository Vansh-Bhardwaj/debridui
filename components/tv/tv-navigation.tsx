"use client";

import { ProfileSwitcher } from "@/components/profiles/profile-switcher";
import { memo, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
    HomeIcon,
    SearchIcon,
    FolderOpen,
    Bookmark,
    History,
    Compass,
    MoreHorizontal,
    Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTVMode } from "@/hooks/use-tv-mode";
import { useDevice } from "@/components/device/device-provider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePreviewStore } from "@/lib/stores/preview";

const tvNavItems = [
    { title: "Home", url: "/dashboard", icon: HomeIcon },
    { title: "Search", url: "/search", icon: SearchIcon },
    { title: "Browse", url: "/discover/browse", icon: Compass },
    { title: "My List", url: "/watchlist", icon: Bookmark },
    { title: "History", url: "/history", icon: History },
    { title: "Files", url: "/files", icon: FolderOpen },
];

const moreItems = [
    { title: "Links", url: "/links" },
    { title: "Addons", url: "/addons" },
    { title: "Accounts", url: "/accounts" },
    { title: "Settings", url: "/settings" },
    { title: "Status", url: "/status" },
    { title: "Help", url: "/help" },
];

export const TVNavigationBar = memo(function TVNavigationBar() {
    const { tvMode, toggle } = useTVMode();
    const pathname = usePathname();
    const router = useRouter();
    const { isTV } = useDevice();
    const [moreOpen, setMoreOpen] = useState(false);
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

    if (!tvMode || previewOpen) return null;

    return (
        <nav className="tv-nav-bar fixed top-0 inset-x-0 z-[60] flex items-center justify-between h-16 px-6 mt-[env(safe-area-inset-top)] bg-background/80 backdrop-blur-xl border-b border-border/30">
            {/* Brand */}
            <span className="hidden 2xl:inline text-xs tracking-widest uppercase text-muted-foreground">
                DebridUI
            </span>

            {/* Nav items */}
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto" data-tv-section="nav">
                {tvNavItems.map((item) => {
                    const isActive = pathname === item.url || pathname.startsWith(item.url + "/");
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.url}
                            onClick={() => router.push(item.url)}
                            data-tv-focusable
                            aria-label={item.title}
                            data-active={isActive || undefined}
                            className={cn(
                                "tv-nav-item relative flex shrink-0 items-center gap-2 px-3 py-2 text-tv-base transition-colors",
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
                <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
                    <DialogTrigger asChild>
                        <button data-tv-focusable className="tv-nav-item flex items-center gap-2 px-3 py-2 text-tv-base" data-active={moreItems.some((item) => pathname.startsWith(item.url)) || undefined}>
                            <MoreHorizontal className="size-5" /> More
                        </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader><DialogTitle className="text-tv-title">More</DialogTitle></DialogHeader>
                        <div data-tv-section="more-routes" className="grid grid-cols-2 gap-4">
                            {moreItems.map((item) => <Button key={item.url} variant="outline" data-tv-focusable className="h-auto py-4 text-tv-base" onClick={() => { setMoreOpen(false); router.push(item.url); }}>{item.title}</Button>)}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Clock + Exit */}
            <div className="flex shrink-0 items-center gap-4" data-tv-section="nav-profile">
                <ProfileSwitcher />
                {clock && (
                    <span className="tv-clock hidden 2xl:inline text-sm text-muted-foreground/60 font-light">
                        {clock}
                    </span>
                )}
                {!isTV && <Button
                    variant="outline"
                    size="sm"
                    onClick={toggle}
                    data-tv-focusable
                    className="text-muted-foreground"
                >
                    <Monitor className="size-4" />
                    Exit
                </Button>}
            </div>
        </nav>
    );
});
