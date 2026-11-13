"use client";

import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
    useSettingsStore,
    QUALITY_PROFILES,
    type QualityProfileId,
    type QualityRange,
    type StreamingSettings,
} from "@/lib/stores/settings";
import { RESOLUTIONS, SOURCE_QUALITIES } from "@/lib/addons/parser";
import { Resolution } from "@/lib/addons/types";
import { cn } from "@/lib/utils";
import { SettingsSelect } from "./setting-row";

const resolutionOptions = [
    { value: "any", label: "Any" },
    ...RESOLUTIONS.map((value) => ({ value, label: value === Resolution.UHD_4K ? "4K" : value })).reverse(),
];
const sourceOptions = [{ value: "any", label: "Any" }, ...SOURCE_QUALITIES.map((value) => ({ value, label: value }))];
const rangeControls: { key: keyof QualityRange; label: string; options: typeof sourceOptions }[] = [
    { key: "minResolution", label: "Minimum Resolution", options: resolutionOptions },
    { key: "maxResolution", label: "Maximum Resolution", options: resolutionOptions },
    { key: "minSourceQuality", label: "Minimum Source Quality", options: sourceOptions },
    { key: "maxSourceQuality", label: "Maximum Source Quality", options: sourceOptions },
];

export function QualityProfile() {
    const { get, set } = useSettingsStore();
    const streaming = get("streaming");
    const update = (updates: Partial<StreamingSettings>) => set("streaming", { ...streaming, ...updates });
    const selectProfile = (profileId: QualityProfileId) => {
        if (profileId === "custom" && streaming.profileId !== "custom") {
            const current = QUALITY_PROFILES.find((profile) => profile.id === streaming.profileId);
            if (current) {
                update({ profileId, customRange: { ...current.range } });
                return;
            }
        }
        update({ profileId });
    };
    return (
        <div className="space-y-3">
            <h3 className="text-sm">Quality Profile</h3>
            <div data-tv-section="quality-presets" className="flex flex-wrap gap-2">
                {[...QUALITY_PROFILES, { id: "custom" as const, name: "Custom", description: "" }].map((profile) => (
                    <button
                        key={profile.id}
                        data-tv-focusable
                        aria-pressed={streaming.profileId === profile.id}
                        onClick={() => selectProfile(profile.id)}
                        className={cn(
                            "min-h-phone-touch border px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-primary",
                            streaming.profileId === profile.id
                                ? "border-primary bg-primary/5"
                                : "border-border/50 text-muted-foreground hover:bg-muted/50"
                        )}>
                        {profile.name}
                        {profile.description && <span className="ml-2 text-xs opacity-60">{profile.description}</span>}
                    </button>
                ))}
            </div>
            <Collapsible open={streaming.profileId === "custom"}>
                <CollapsibleContent>
                    <div className="grid gap-4 border border-border/50 bg-muted/30 p-4 sm:grid-cols-2">
                        {rangeControls.map(({ key, label, options }) => (
                            <div key={key} data-tv-section={`quality-${key}`} className="space-y-2">
                                <p className="text-xs tracking-widest uppercase text-muted-foreground">{label}</p>
                                <SettingsSelect
                                    id={`quality-${key}`}
                                    label={label}
                                    value={streaming.customRange[key]}
                                    options={options}
                                    onChange={(value) =>
                                        update({ customRange: { ...streaming.customRange, [key]: value } })
                                    }
                                />
                            </div>
                        ))}
                        <p className="text-xs text-muted-foreground sm:col-span-2">
                            Sources outside these ranges will be filtered out during auto-selection.
                        </p>
                    </div>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
