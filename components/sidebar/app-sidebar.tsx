"use client";

import * as React from "react";
import { useMemo } from "react";

import { NavMain } from "@/components/sidebar/nav-main";
import { NavUser } from "@/components/sidebar/nav-user";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";
import { AccountSwitcher } from "./account-switcher";
import { FolderOpen, SearchIcon, HomeIcon, SettingsIcon, UsersIcon, Puzzle, Link2, HelpCircle, Activity, Bookmark, History, Compass } from "lucide-react";
import { useSearch } from "@/components/mdb/search-provider";
import { useTraktRecentEpisodes } from "@/hooks/use-trakt";

function WatchlistBadge() {
    const { data } = useTraktRecentEpisodes(7);
    const count = useMemo(() => {
        if (!data) return 0;
        return data.filter((item) => {
            const aired = item.first_aired ? new Date(item.first_aired).getTime() : 0;
            return aired > 0 && aired <= new Date().getTime();
        }).length;
    }, [data]);

    if (count === 0) return null;
    return (
        <span className="ml-auto text-[10px] font-medium leading-none text-primary">
            {count}
        </span>
    );
}

const browseNav = [
        {
            title: "Dashboard",
            url: "/dashboard",
            icon: HomeIcon,
        },
        {
            title: "Search",
            url: "/search",
            icon: SearchIcon,
        },
        {
            title: "Browse",
            url: "/discover/browse",
            icon: Compass,
        },
        {
            title: "Watchlist",
            url: "/watchlist",
            icon: Bookmark,
        },
        {
            title: "History",
            url: "/history",
            icon: History,
        },
        {
            title: "Files",
            url: "/files",
            icon: FolderOpen,
        },
    ];

const manageNav = [
        {
            title: "Links",
            url: "/links",
            icon: Link2,
        },
        {
            title: "Addons",
            url: "/addons",
            icon: Puzzle,
        },
        {
            title: "Accounts",
            url: "/accounts",
            icon: UsersIcon,
        },
        {
            title: "Status",
            url: "/status",
            icon: Activity,
        },
        {
            title: "Settings",
            url: "/settings",
            icon: SettingsIcon,
        },
    ];

const navSecondary = [
    {
        title: "Help",
        url: "/help",
        icon: HelpCircle,
    },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { toggle: toggleSearch } = useSearch();

    // Inject live badge into the Watchlist nav item
    const navBrowse = useMemo(() =>
        browseNav.map((item) =>
            item.title === "Watchlist"
                ? { ...item, badge: <WatchlistBadge /> }
                : item
        ), []);

    const handleNavAction = (action?: string) => {
        if (action === "search") {
            toggleSearch();
        }
    };

    return (
        <Sidebar collapsible={"icon"} {...props}>
            <SidebarHeader className="border-b border-sidebar-border/50">
                <AccountSwitcher />
            </SidebarHeader>
            <SidebarContent>
                <NavMain items={navBrowse} onAction={handleNavAction} label="Browse" />
                <NavMain items={manageNav} onAction={handleNavAction} label="Manage" className="pt-1" />
                <NavMain items={navSecondary} className="mt-auto" variant="subtle" label="Support" />
            </SidebarContent>
            <SidebarFooter className="border-t border-sidebar-border/50">
                <NavUser />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
