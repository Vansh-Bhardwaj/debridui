"use client";

import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevice } from "@/components/device/device-provider";
import type { SettingEntry } from "@/lib/settings/registry";

export function SettingsSelect({
    id,
    label,
    value,
    onChange,
    options,
}: {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
}) {
    const { isPhone } = useDevice();
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger
                id={id}
                aria-label={label}
                data-tv-focusable
                className={isPhone ? "min-h-phone-touch w-full sm:w-44" : "w-full sm:w-44"}>
                <SelectValue placeholder="Select an option" />
            </SelectTrigger>
            <SelectContent data-tv-section={`${id}-options`}>
                {options.map((option) => (
                    <SelectItem
                        key={option.value}
                        value={option.value}
                        data-tv-focusable
                        className={isPhone ? "min-h-phone-touch" : ""}>
                        {option.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

export function SettingRow({ entry, children }: { entry: SettingEntry; children: ReactNode }) {
    return (
        <div
            data-tv-section={entry.id}
            className="min-h-phone-touch flex flex-col gap-4 border border-border/50 bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
                <Label htmlFor={entry.id} className="text-sm">
                    {entry.label}
                </Label>
                {entry.description && (
                    <p id={`${entry.id}-description`} className="text-xs text-muted-foreground">
                        {entry.description}
                    </p>
                )}
                <p className="text-xs tracking-widest uppercase text-muted-foreground">{entry.scope}</p>
            </div>
            {children}
        </div>
    );
}
