export type DeviceClass = "phone" | "tablet" | "desktop" | "tv";

export const DEVICE_OVERRIDE_KEY = "dui-device-override";

export function isDeviceClass(value: unknown): value is DeviceClass {
    return value === "phone" || value === "tablet" || value === "desktop" || value === "tv";
}

export function detectDeviceClass({ ua, chMobile, chPlatform }: {
    ua: string;
    chMobile?: string | null;
    chPlatform?: string | null;
}): DeviceClass {
    // Case-sensitive so short tokens (AFT = Fire TV, TV) don't match ordinary words.
    if (/Google\s?TV|CrKey|SmartTV|SMART-TV|Tizen|Web0S|webOS|VIDAA|BRAVIA|\bAFT[A-Z]|\bTV\b/.test(ua)) return "tv";
    if (/iPad/i.test(ua)) return "tablet";
    const mobile = /Mobile/i.test(ua) || chMobile === "?1";
    if ((/Android/i.test(ua) || /Android/i.test(chPlatform ?? "")) && !mobile) return "tablet";
    return mobile ? "phone" : "desktop";
}
