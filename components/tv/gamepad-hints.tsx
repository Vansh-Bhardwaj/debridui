"use client";

import { useEffect, useState, useRef } from "react";
import { useSettingsStore } from "@/lib/stores/settings";

const IDLE_TIMEOUT = 5000; // Hide after 5s of inactivity

interface HintItem {
    label: string;
    action: string;
}

const NAV_HINTS: HintItem[] = [
    { label: "A", action: "Select" },
    { label: "B", action: "Back" },
    { label: "LB/RB", action: "Section" },
];

const VIDEO_HINTS: HintItem[] = [
    { label: "A", action: "Play/Pause" },
    { label: "B", action: "Back" },
    { label: "X", action: "Play/Pause" },
    { label: "Y", action: "Fullscreen" },
    { label: "LB/RB", action: "Prev/Next" },
    { label: "LT/RT", action: "Seek ±30s" },
];

export function GamepadHints() {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const [gamepadConnected, setGamepadConnected] = useState(() => {
        if (typeof navigator === "undefined") return false;
        const gps = navigator.getGamepads?.();
        return gps ? Array.from(gps).some((g) => g !== null) : false;
    });
    const [visible, setVisible] = useState(false);
    const [hasVideo, setHasVideo] = useState(false);
    const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    const showHints = () => {
        setVisible(true);
        clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(() => setVisible(false), IDLE_TIMEOUT);
    };

    // Track gamepad connection
    useEffect(() => {
        if (!tvMode) return;

        const onConnect = () => { setGamepadConnected(true); showHints(); };
        const onDisconnect = () => {
            const gps = navigator.getGamepads?.();
            const any = gps ? Array.from(gps).some((g) => g !== null) : false;
            setGamepadConnected(any);
        };

        window.addEventListener("gamepadconnected", onConnect);
        window.addEventListener("gamepaddisconnected", onDisconnect);
        return () => {
            window.removeEventListener("gamepadconnected", onConnect);
            window.removeEventListener("gamepaddisconnected", onDisconnect);
        };
    }, [tvMode]);

    // Track video presence
    useEffect(() => {
        if (!tvMode || !gamepadConnected) return;
        const id = setInterval(() => {
            setHasVideo(!!document.querySelector("video"));
        }, 1000);
        return () => clearInterval(id);
    }, [tvMode, gamepadConnected]);

    // Show on any gamepad input
    useEffect(() => {
        if (!tvMode || !gamepadConnected) return;
        let rafId: number;
        const prevButtons = new Map<number, boolean[]>();

        const poll = () => {
            const gamepads = navigator.getGamepads?.();
            if (gamepads) {
                for (const gp of gamepads) {
                    if (!gp) continue;
                    const prev = prevButtons.get(gp.index) ?? [];
                    const cur = gp.buttons.map((b) => b.pressed);
                    if (cur.some((pressed, i) => pressed && !prev[i])) showHints();
                    prevButtons.set(gp.index, cur);
                }
            }
            rafId = requestAnimationFrame(poll);
        };
        rafId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafId);
    }, [tvMode, gamepadConnected]);

    if (!tvMode || !gamepadConnected) return null;

    const hints = hasVideo ? VIDEO_HINTS : NAV_HINTS;

    return (
        <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none transition-opacity duration-500"
            style={{ opacity: visible ? 1 : 0 }}
        >
            <div className="flex items-center gap-4 rounded-sm bg-background/80 backdrop-blur-sm border border-border/30 px-5 py-2.5">
                {hints.map((hint) => (
                    <div key={hint.label} className="flex items-center gap-1.5">
                        <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-sm bg-muted/50 border border-border/50 text-[0.6875rem] font-medium text-foreground">
                            {hint.label}
                        </kbd>
                        <span className="text-[0.6875rem] text-muted-foreground">{hint.action}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
