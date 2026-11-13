import { describe, expect, test } from "bun:test";
import { detectDeviceClass, type DeviceClass } from "../lib/device/detect";

const devices: [string, string, DeviceClass][] = [
    ["iPhone Safari", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "phone"],
    ["Android phone Chrome", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36", "phone"],
    ["Android tablet", "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "tablet"],
    ["iPad", "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "tablet"],
    ["Windows Chrome", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "desktop"],
    ["macOS Safari", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "desktop"],
    ["Chromecast with Google TV", "Mozilla/5.0 (Linux; Android 12; Chromecast Build/STTL.240206.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.230 Safari/537.36 CrKey/1.56.500000", "tv"],
    ["Fire TV AFTMM", "Mozilla/5.0 (Linux; Android 7.1.2; AFTMM) AppleWebKit/537.36 (KHTML, like Gecko) Silk/80.5.3 like Chrome/80.0.3987.162 Safari/537.36", "tv"],
    ["Samsung Tizen", "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 TV Safari/537.36", "tv"],
    ["LG webOS", "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager", "tv"],
    ["Hisense VIDAA", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.146 Safari/537.36 VIDAA/6.0", "tv"],
];

describe("detectDeviceClass", () => {
    test.each(devices)("%s", (_name, ua, expected) => {
        expect(detectDeviceClass({ ua })).toBe(expected);
    });

    test.each(["Android TV", "GoogleTV", "Google TV", "CrKey", "SmartTV", "Tizen", "Web0S", "webOS", "VIDAA", "AFTMM", "BRAVIA", " TV"])("TV token %s wins over Mobile", (token) => {
        expect(detectDeviceClass({ ua: `Mozilla/5.0 ${token} Android Mobile`, chMobile: "?1" })).toBe("tv");
    });

    test("client hints identify reduced Android UAs", () => {
        expect(detectDeviceClass({ ua: "Mozilla/5.0", chMobile: "?1", chPlatform: '"Android"' })).toBe("phone");
        expect(detectDeviceClass({ ua: "Mozilla/5.0", chMobile: "?0", chPlatform: '"Android"' })).toBe("tablet");
    });

    test("non-mobile hints do not override Mobile or iPad UAs", () => {
        expect(detectDeviceClass({ ua: devices[0][1], chMobile: "?0" })).toBe("phone");
        expect(detectDeviceClass({ ua: devices[3][1], chMobile: "?1" })).toBe("tablet");
    });

    test("missing UA defaults to desktop", () => {
        expect(detectDeviceClass({ ua: "" })).toBe("desktop");
    });
});
