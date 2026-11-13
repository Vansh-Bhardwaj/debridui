"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, HelpCircle, History, Link2, Puzzle, Settings, User, Users } from "lucide-react";
import { ProfileSwitcher } from "@/components/profiles/profile-switcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const links = [
    { label: "Settings", href: "/settings", icon: Settings },
    { label: "Accounts", href: "/accounts", icon: Users },
    { label: "Addons", href: "/addons", icon: Puzzle },
    { label: "History", href: "/history", icon: History },
    { label: "Links", href: "/links", icon: Link2 },
    { label: "Status", href: "/status", icon: Activity },
    { label: "Help", href: "/help", icon: HelpCircle },
];

export function YouMenu({ iconOnly = false }: { iconOnly?: boolean }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const active = pathname.startsWith("/profiles") || links.some(({ href }) => pathname === href || pathname.startsWith(href + "/"));
    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" aria-label="You" className={cn("h-16 min-h-phone-touch min-w-phone-touch flex-1 flex-col gap-1 px-1 text-xs font-normal data-[state=open]:text-primary", active ? "text-primary bg-muted/30" : "text-muted-foreground")}>
                    <User className="size-5" />
                    <span className={iconOnly ? "sr-only" : ""}>You</span>
                </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[calc(100dvh-env(safe-area-inset-top))] overflow-y-auto gap-0 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-none [&>button]:min-h-phone-touch [&>button]:min-w-phone-touch [&>button]:top-1 [&>button]:right-1 [&>button]:flex [&>button]:items-center [&>button]:justify-center">
                <SheetHeader>
                    <SheetTitle>You</SheetTitle>
                    <SheetDescription>Profiles, library and setup</SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4"><ProfileSwitcher /></div>
                <nav aria-label="Your account" className="border-t border-border/50 px-4 py-2">
                    {links.map(({ label, href, icon: Icon }) => (
                        <Link key={href} href={href} onClick={() => setOpen(false)} className="flex min-h-phone-touch items-center gap-3 px-3 text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
                            <Icon className="size-4 text-muted-foreground" />{label}
                        </Link>
                    ))}
                </nav>
            </SheetContent>
        </Sheet>
    );
}
