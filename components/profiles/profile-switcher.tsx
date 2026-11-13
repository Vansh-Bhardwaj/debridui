"use client";

import Link from "next/link";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ProfileSwitcher() {
    const { profiles, activeProfile, switchProfile } = useProfile();
    return <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="outline" data-tv-focusable className="min-h-phone-touch">
                <span aria-hidden style={{ backgroundColor: activeProfile.color ?? "#596869" }} className="flex size-7 items-center justify-center text-white">{activeProfile.name[0]?.toUpperCase()}</span>
                {activeProfile.name}
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-tv-section="profile-switcher">
            {profiles.map((profile) => <DropdownMenuItem key={profile.id} data-tv-focusable onSelect={() => { void switchProfile(profile.id).catch(() => toast.error("Could not switch profile")); }} className="min-h-phone-touch" aria-current={profile.id === activeProfile.id ? "true" : undefined}>
                <span className={profile.id === activeProfile.id ? "text-primary" : ""}>{profile.name}</span>
            </DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/profiles?manage=1" data-tv-focusable className="min-h-phone-touch">Manage profiles</Link></DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>;
}
