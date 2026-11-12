"use client";

import { memo, useEffect, useState } from "react";
import { usePreviewStore } from "@/lib/stores/preview";
import { cn } from "@/lib/utils";

const IDLE_MS = 5 * 60 * 1000;
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "focusin", "touchstart"] as const;

/**
 * Big Picture session helpers, mounted once by the TV layout:
 * - keeps the screen awake while browsing on a TV (Screen Wake Lock API)
 * - after 5 minutes without input (and nothing playing) dims to a quiet clock
 *   screen to avoid burn-in; any key, click or controller input wakes it
 */
export const BigPictureSession = memo(function BigPictureSession() {
    const previewOpen = usePreviewStore((s) => s.isOpen);
    const [idle, setIdle] = useState(false);
    const [now, setNow] = useState(() => new Date());

    // Wake lock is released by the browser whenever the tab is hidden; re-acquire on return.
    useEffect(() => {
        if (!("wakeLock" in navigator)) return;
        let lock: WakeLockSentinel | null = null;
        let cancelled = false;
        const acquire = async () => {
            if (document.visibilityState !== "visible" || lock) return;
            try {
                lock = await navigator.wakeLock.request("screen");
                if (cancelled) await lock.release();
                lock?.addEventListener("release", () => { lock = null; });
            } catch { /* denied (battery saver, permissions) — not critical */ }
        };
        void acquire();
        document.addEventListener("visibilitychange", acquire);
        return () => {
            cancelled = true;
            document.removeEventListener("visibilitychange", acquire);
            void lock?.release().catch(() => {});
        };
    }, []);

    useEffect(() => {
        if (previewOpen) return;
        let timer = setTimeout(() => setIdle(true), IDLE_MS);
        const onActivity = () => {
            setIdle(false);
            clearTimeout(timer);
            timer = setTimeout(() => setIdle(true), IDLE_MS);
        };
        ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
        return () => {
            clearTimeout(timer);
            ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
        };
    }, [previewOpen]);

    useEffect(() => {
        if (!idle) return;
        const id = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(id);
    }, [idle]);

    const showIdle = idle && !previewOpen;

    return (
        <div
            aria-hidden={!showIdle}
            onClick={() => setIdle(false)}
            className={cn(
                "fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/90 backdrop-blur-sm",
                "transition-opacity duration-1000 ease-out motion-reduce:transition-none",
                showIdle ? "opacity-100" : "pointer-events-none opacity-0"
            )}>
            {showIdle && (
                <>
                    <span className="text-7xl font-light tabular-nums tracking-tight text-foreground/90">
                        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="text-sm tracking-widest uppercase text-muted-foreground">
                        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                    </span>
                    <span className="mt-10 text-xs text-muted-foreground/60">Press any button to continue</span>
                </>
            )}
        </div>
    );
});
