"use client";

import { useDevice } from "@/components/device/device-provider";

export function useIsMobile() {
    return useDevice().isPhone;
}
