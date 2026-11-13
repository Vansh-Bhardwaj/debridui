"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { DEVICE_OVERRIDE_KEY, detectDeviceClass, isDeviceClass, type DeviceClass } from "@/lib/device/detect";

type DeviceContextValue = {
    device: DeviceClass;
    isPhone: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isTV: boolean;
    setOverride: (device: DeviceClass | null) => void;
};

const DeviceContext = createContext<DeviceContextValue | null>(null);
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getDevice(): DeviceClass {
    const override = localStorage.getItem(DEVICE_OVERRIDE_KEY);
    if (isDeviceClass(override)) return override;
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean; platform?: string } };
    const detected = detectDeviceClass({
        ua: nav.userAgent,
        chMobile: nav.userAgentData?.mobile ? "?1" : null,
        chPlatform: nav.userAgentData?.platform,
    });
    // iPadOS presents a Mac UA; touch points give it away.
    return detected === "desktop" && /Macintosh/i.test(nav.userAgent) && nav.maxTouchPoints > 1 ? "tablet" : detected;
}

function setOverride(device: DeviceClass | null) {
    if (device) localStorage.setItem(DEVICE_OVERRIDE_KEY, device);
    else localStorage.removeItem(DEVICE_OVERRIDE_KEY);
    listeners.forEach((l) => l());
}

// Detection is client-only so pages stay statically rendered (Cloudflare CPU limits).
// App pages render after the client session check, so they never show the server value.
export function DeviceProvider({ children }: { children: React.ReactNode }) {
    const device = useSyncExternalStore(subscribe, getDevice, () => "desktop" as const);
    const value = useMemo(
        () => ({
            device,
            isPhone: device === "phone",
            isTablet: device === "tablet",
            isDesktop: device === "desktop",
            isTV: device === "tv",
            setOverride,
        }),
        [device]
    );
    return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
}

export function useDevice() {
    const context = useContext(DeviceContext);
    if (!context) throw new Error("useDevice must be used within DeviceProvider");
    return context;
}
