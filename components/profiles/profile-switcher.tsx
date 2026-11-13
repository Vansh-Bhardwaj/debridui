"use client";

import Link from "next/link";
import { Check } from "reicon-react";
import { toast } from "sonner";
import { useProfile } from "@/hooks/use-profile";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProfileAvatar } from "./profile-avatar";

export function ProfileSwitcher() {
    const { profiles, activeProfile, switchProfile } = useProfile();
    return <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="outline" data-tv-focusable className="min-h-phone-touch gap-2.5 pl-1.5">
                <ProfileAvatar profile={activeProfile} className="size-7" />
                {activeProfile.name}
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-tv-section="profile-switcher" className="min-w-52">
            {profiles.map((profile) => <DropdownMenuItem key={profile.id} data-tv-focusable onSelect={() => { void switchProfile(profile.id).catch(() => toast.error("Could not switch profile")); }} className="min-h-phone-touch gap-3" aria-current={profile.id === activeProfile.id ? "true" : undefined}>
                <ProfileAvatar profile={profile} className="size-7" />
                <span className="flex-1 truncate">{profile.name}</span>
                {profile.id === activeProfile.id && <Check className="size-4 text-primary" />}
            </DropdownMenuItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/profiles?manage=1" data-tv-focusable className="min-h-phone-touch">Manage profiles</Link></DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>;
}
