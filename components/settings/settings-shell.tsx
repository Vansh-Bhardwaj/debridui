"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Database, Devices, InfoCircle, Palette, PlayCircle, Settings, Subtitles, UserCircle, Users, Wifi, type IconComponent } from "reicon-react";
import { useDevice } from "@/components/device/device-provider";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useUserSettings } from "@/hooks/use-user-settings";
import { AccountType } from "@/lib/types";
import { filterSettings, settingsSections, type SettingsSection } from "@/lib/settings/registry";
import { PageHeader } from "@/components/common/page-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { OAuthFeedback } from "./integrations";
import { RegistrySetting } from "./registry-setting";

const sectionIcons: Record<SettingsSection, IconComponent> = {
    profile: UserCircle, playback: PlayCircle, subtitles: Subtitles, streaming: Wifi, appearance: Palette,
    accounts: Users, devices: Devices, data: Database, about: InfoCircle,
};

export function SettingsShell({ children }: { children: React.ReactNode }) {
    const { device, isDesktop, isTablet } = useDevice();
    const { currentAccount } = useAuthGuaranteed();
    const { data: serverSettings } = useUserSettings();
    const path = usePathname();
    const [search, setSearch] = useState("");
    const showSearch = isDesktop || isTablet;
    const entries = filterSettings(
        {
            device,
            isTorbox: currentAccount.type === AccountType.TORBOX,
            isTraktConnected: !!serverSettings?.trakt_access_token,
        },
        showSearch ? search : ""
    );
    const activeSection = path === "/settings" ? "profile" : path.split("/").at(-1);
    const index = path === "/settings";
    const searching = showSearch && !!search.trim();
    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 pb-32">
            <OAuthFeedback />
            <PageHeader icon={Settings} title="Settings" description="Manage your application preferences" />
            {showSearch && (
                <div data-tv-section="settings-search" className="space-y-3">
                    <Input
                        type="search"
                        aria-label="Search settings"
                        data-tv-focusable
                        placeholder="Search settings…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="min-h-phone-touch"
                    />
                    {searching && (
                        <div aria-live="polite" className="border border-border/50 divide-y divide-border/50">
                            {entries.length === 0 && (
                                <p className="p-4 text-sm text-muted-foreground">No matching settings</p>
                            )}
                            {entries.map((entry) => (
                                <Link
                                    key={entry.id}
                                    href={`/settings/${entry.section}`}
                                    data-tv-focusable
                                    onClick={() => setSearch("")}
                                    className="flex min-h-phone-touch items-center justify-between gap-3 p-3 text-sm hover:bg-muted/50 focus-visible:outline focus-visible:outline-primary">
                                    <span>{entry.label}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {settingsSections.find((section) => section.id === entry.section)?.label}
                                    </span>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            )}
            <div className={cn("gap-8", isDesktop && "grid grid-cols-[13rem_minmax(0,1fr)]")}>
                {(isDesktop || index) && (
                    <nav
                        aria-label="Settings sections"
                        data-tv-section="settings-sections"
                        className={cn("space-y-1", !isDesktop && "grid gap-2 sm:grid-cols-2")}>
                        {settingsSections
                            .filter((section) => entries.some((entry) => entry.section === section.id))
                            .map((section) => {
                                const Icon = sectionIcons[section.id];
                                const current = isDesktop && activeSection === section.id;
                                return (
                                    <Link
                                        key={section.id}
                                        href={`/settings/${section.id}`}
                                        data-tv-focusable
                                        aria-current={current ? "page" : undefined}
                                        className={cn(
                                            "group flex min-h-phone-touch items-center gap-3 text-sm transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-primary",
                                            // Desktop: compact rail with a gold edge on the open section. Touch/TV: cards with a description.
                                            isDesktop ? "border-l-2 border-transparent px-3 py-2" : "border border-border/50 bg-muted/30 p-4",
                                            current && "border-primary bg-muted/50 text-foreground"
                                        )}>
                                        <Icon weight={current ? "Filled" : "Outline"} className={cn("size-5 shrink-0", current ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block">{section.label}</span>
                                            {!isDesktop && <span className="block truncate text-xs text-muted-foreground">{section.description}</span>}
                                        </span>
                                        {!isDesktop && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                                    </Link>
                                );
                            })}
                    </nav>
                )}
                <div className="min-w-0 space-y-6">
                    {!isDesktop && !index && (
                        <Link
                            href="/settings"
                            data-tv-focusable
                            data-tv-section="settings-back"
                            className="inline-flex min-h-phone-touch items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                            <ChevronLeft className="size-4" />
                            All settings
                        </Link>
                    )}
                    {index ? isDesktop && <SettingsSectionContent section="profile" /> : children}
                </div>
            </div>
        </div>
    );
}

export function SettingsSectionContent({ section }: { section: SettingsSection }) {
    const { device } = useDevice();
    const { currentAccount } = useAuthGuaranteed();
    const { data: serverSettings } = useUserSettings();
    const entries = filterSettings({
        device,
        isTorbox: currentAccount.type === AccountType.TORBOX,
        isTraktConnected: !!serverSettings?.trakt_access_token,
    }).filter((entry) => entry.section === section);
    return (
        <section aria-labelledby={`settings-${section}`} className="space-y-4">
            <h2 id={`settings-${section}`} className="text-2xl font-light">
                {settingsSections.find((item) => item.id === section)?.label}
            </h2>
            {entries.map((entry) => (
                <RegistrySetting key={entry.id} entry={entry} />
            ))}
        </section>
    );
}
