"use client";

import { useProfile } from "@/hooks/use-profile";
import { toast } from "sonner";
import { useState } from "react";
import { Check, ChevronExpandY as ChevronsUpDown, Logout as LogOut, User as UserIcon, Settings, HelpCircle, Activity, Tv } from "reicon-react";

import { ProfileAvatar } from "@/components/profiles/profile-avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { useTVMode } from "@/hooks/use-tv-mode";
import Link from "next/link";
import { useDevice } from "@/components/device/device-provider";

export function NavUser() {
    const { profiles, activeProfile, switchProfile } = useProfile();
    const { setOpenMobile } = useSidebar();
    const { isPhone, isDesktop } = useDevice();
    const { session, logout, isLoggingOut } = useAuth();
    const [showLogoutDialog, setShowLogoutDialog] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const { toggle: toggleTV } = useTVMode();

    const user = { name: activeProfile.name, email: session?.user?.email || "" };

    const handleNavigation = () => {
        setDropdownOpen(false);
        if (isPhone) {
            setTimeout(() => setOpenMobile(false), 150);
        }
    };

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                            <ProfileAvatar profile={activeProfile} className="size-8" />
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-light">{user.name}</span>
                                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                            </div>
                            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuPortal>
                        <DropdownMenuContent
                            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                            side={isPhone ? "bottom" : "right"}
                            align="end"
                            sideOffset={4}>
                            <DropdownMenuLabel className="p-0 font-normal">
                                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                    <ProfileAvatar profile={activeProfile} className="size-8" />
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-light">{user.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                                    </div>
                                </div>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Profiles</DropdownMenuLabel>
                            {profiles.map((profile) => <DropdownMenuItem key={profile.id} className="min-h-phone-touch gap-3" onSelect={() => {
                                handleNavigation();
                                void switchProfile(profile.id).catch(() => toast.error("Could not switch profile"));
                            }}>
                                <ProfileAvatar profile={profile} className="size-6" />
                                <span className="flex-1 truncate">{profile.name}</span>
                                {profile.id === activeProfile.id && <Check className="size-4 text-primary" />}
                            </DropdownMenuItem>)}
                            <DropdownMenuItem asChild><Link href="/profiles?manage=1" onClick={handleNavigation} className="min-h-phone-touch">Manage profiles</Link></DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings/account" onClick={handleNavigation}>
                                        <UserIcon />
                                        Profile
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/settings" onClick={handleNavigation}>
                                        <Settings />
                                        Settings
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/help" onClick={handleNavigation}>
                                        <HelpCircle />
                                        Help
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/status" onClick={handleNavigation}>
                                        <Activity />
                                        Status
                                    </Link>
                                </DropdownMenuItem>
                                {isDesktop && (
                                    <DropdownMenuItem onClick={() => { setDropdownOpen(false); toggleTV(); }}>
                                        <Tv />
                                        Big Picture
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => {
                                    setDropdownOpen(false);
                                    setShowLogoutDialog(true);
                                }}
                                disabled={isLoggingOut}
                                className="text-destructive focus:text-destructive">
                                <LogOut />
                                {isLoggingOut ? "Logging out..." : "Log out"}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenuPortal>
                </DropdownMenu>
            </SidebarMenuItem>

            <ConfirmDialog
                open={showLogoutDialog}
                onOpenChange={setShowLogoutDialog}
                title="Log out"
                description="Are you sure you want to log out? You will need to sign in again to access your account."
                confirmText="Log out"
                cancelText="Cancel"
                onConfirm={() => {
                    setShowLogoutDialog(false);
                    logout();
                }}
                variant="destructive"
            />
        </SidebarMenu>
    );
}
