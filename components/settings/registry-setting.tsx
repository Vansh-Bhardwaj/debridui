"use client";

import { Switch } from "@/components/ui/switch";
import { useDevice } from "@/components/device/device-provider";
import { useSettingsStore, type PlaybackSettings, type StreamingSettings } from "@/lib/stores/settings";
import type { SettingEntry, SettingKey } from "@/lib/settings/registry";
import { CustomSetting } from "./custom-setting";
import { SettingRow, SettingsSelect } from "./setting-row";

export function RegistrySetting({ entry }: { entry: SettingEntry }) {
    const { get, set } = useSettingsStore();
    const { isPhone } = useDevice();
    const control = entry.control;
    if (control.type === "custom")
        return (
            <div data-tv-section={entry.id} className="space-y-3">
                <CustomSetting entry={entry} component={control.component} />
            </div>
        );
    const read = (key: SettingKey) => {
        if (key === "deviceSync" || key === "tvMode") return get(key);
        if (key.startsWith("playback.")) return get("playback")[key.slice(9) as keyof PlaybackSettings];
        return get("streaming")[key.slice(10) as keyof StreamingSettings];
    };
    const update = (key: SettingKey, value: string | number | boolean) => {
        if (key === "deviceSync" || key === "tvMode") set(key, Boolean(value));
        else if (key.startsWith("playback.")) set("playback", { ...get("playback"), [key.slice(9)]: value });
        else set("streaming", { ...get("streaming"), [key.slice(10)]: value });
    };
    return (
        <SettingRow entry={entry}>
            {control.type === "switch" ? (
                <Switch
                    id={entry.id}
                    aria-describedby={`${entry.id}-description`}
                    data-tv-focusable
                    className={isPhone ? "min-h-phone-touch min-w-phone-touch" : ""}
                    checked={Boolean(read(control.key))}
                    onCheckedChange={(value) => update(control.key, value)}
                />
            ) : (
                <SettingsSelect
                    id={entry.id}
                    label={entry.label}
                    value={String(read(control.key))}
                    options={control.options}
                    onChange={(value) => update(control.key, control.numeric ? Number(value) : value)}
                />
            )}
        </SettingRow>
    );
}
