"use client";

import { useEffect, useState } from "react";

export function useDelayedFlag(active: boolean, delayMs: number = 120): boolean {
    const [delayedActive, setDelayedActive] = useState(false);

    useEffect(() => {
        if (!active) {
            const resetTimeout = setTimeout(() => {
                setDelayedActive(false);
            }, 0);
            return () => clearTimeout(resetTimeout);
        }

        const timeout = setTimeout(() => {
            setDelayedActive(true);
        }, delayMs);

        return () => clearTimeout(timeout);
    }, [active, delayMs]);

    return delayedActive;
}
