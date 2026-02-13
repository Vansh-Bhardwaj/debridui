"use client";

import { memo } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import { Cast } from "lucide-react";

/**
 * Small top banner shown when this device is being controlled by another device.
 * Provides visual feedback that remote commands are active.
 */
export const ControlledIndicator = memo(function ControlledIndicator() {
    const controlledBy = useDeviceSyncStore((s) => s.controlledBy);
    const enabled = useDeviceSyncStore((s) => s.enabled);

    if (!enabled || !controlledBy) return null;

    return (
        <div className="flex items-center justify-center gap-2 px-3 py-1 bg-primary/10 border-b border-primary/20 text-xs text-primary">
            <Cast className="size-3" />
            <span>Controlled by {controlledBy.name}</span>
        </div>
    );
});
