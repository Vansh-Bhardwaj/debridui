"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
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
                            .map((section) => (
                                <Link
                                    key={section.id}
                                    href={`/settings/${section.id}`}
                                    data-tv-focusable
                                    aria-current={activeSection === section.id ? "page" : undefined}
                                    className={cn(
                                        "flex min-h-phone-touch items-center border border-border/50 px-4 py-3 text-sm hover:bg-muted/50 focus-visible:outline focus-visible:outline-primary",
                                        activeSection === section.id && "border-primary bg-muted/30"
                                    )}>
                                    {section.label}
                                </Link>
                            ))}
                    </nav>
                )}
                <div className="min-w-0 space-y-6">
                    {!isDesktop && !index && (
                        <Link
                            href="/settings"
                            data-tv-focusable
                            data-tv-section="settings-back"
                            className="inline-flex min-h-phone-touch items-center text-sm text-primary">
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
