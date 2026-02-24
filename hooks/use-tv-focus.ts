"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSettingsStore } from "@/lib/stores/settings";

/**
 * Spatial navigation for TV mode.
 * Arrow keys / gamepad D-pad move focus between `[data-tv-focusable]` elements.
 * Focus is scoped to sections (`[data-tv-section]`) for up/down,
 * and individual items within a section for left/right.
 *
 * Gamepad mapping (Standard layout):
 *   D-pad / Left stick — Navigate
 *   A (0)  — Select/click
 *   B (1)  — Back
 *   X (2)  — Play/pause (when video active)
 *   Y (3)  — Toggle fullscreen (when video active)
 *   LB (4) — Previous section / seek -10s
 *   RB (5) — Next section / seek +10s
 *   LT (6) — Seek -30s (when video active)
 *   RT (7) — Seek +30s (when video active)
 *   Start (9) — Toggle play/pause
 *   Guide (16) — Toggle TV mode
 */
export function useTVFocus() {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const pathname = usePathname();
    const lastFocusedRef = useRef<HTMLElement | null>(null);

    // Detect if a video is currently playing in the preview
    const getActiveVideo = useCallback((): HTMLVideoElement | null => {
        return document.querySelector("video");
    }, []);

    const getAllFocusable = useCallback(() => {
        return Array.from(
            document.querySelectorAll<HTMLElement>("[data-tv-focusable]:not([disabled]):not([aria-hidden='true'])")
        ).filter((el) => el.offsetParent !== null);
    }, []);

    const getSections = useCallback(() => {
        return Array.from(document.querySelectorAll<HTMLElement>("[data-tv-section]"));
    }, []);

    const getFocusablesInSection = useCallback((section: HTMLElement) => {
        return Array.from(
            section.querySelectorAll<HTMLElement>("[data-tv-focusable]:not([disabled])")
        ).filter((el) => el.offsetParent !== null);
    }, []);

    const focusElement = useCallback((el: HTMLElement | null) => {
        if (!el) return;
        el.focus({ preventScroll: false });
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        lastFocusedRef.current = el;
    }, []);

    const findClosestInDirection = useCallback(
        (current: HTMLElement, items: HTMLElement[], direction: "left" | "right" | "up" | "down") => {
            const rect = current.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            let best: HTMLElement | null = null;
            let bestDist = Infinity;

            for (const item of items) {
                if (item === current) continue;
                const r = item.getBoundingClientRect();
                const ix = r.left + r.width / 2;
                const iy = r.top + r.height / 2;

                const isValid =
                    direction === "left" ? ix < cx - 10 :
                    direction === "right" ? ix > cx + 10 :
                    direction === "up" ? iy < cy - 10 :
                    iy > cy + 10;

                if (!isValid) continue;

                const dx = ix - cx;
                const dy = iy - cy;
                const isHorizontal = direction === "left" || direction === "right";
                const dist = isHorizontal
                    ? Math.abs(dx) + Math.abs(dy) * 3
                    : Math.abs(dy) + Math.abs(dx) * 3;

                if (dist < bestDist) {
                    bestDist = dist;
                    best = item;
                }
            }
            return best;
        },
        []
    );

    const handleNavigation = useCallback(
        (direction: "left" | "right" | "up" | "down") => {
            const current = document.activeElement as HTMLElement;
            const all = getAllFocusable();

            if (!current?.hasAttribute("data-tv-focusable")) {
                focusElement(all[0] ?? null);
                return;
            }

            if (direction === "left" || direction === "right") {
                const section = current.closest("[data-tv-section]") as HTMLElement | null;
                const pool = section ? getFocusablesInSection(section) : all;
                const next = findClosestInDirection(current, pool, direction);
                if (next) focusElement(next);
            } else {
                const sections = getSections();
                const currentSection = current.closest("[data-tv-section]") as HTMLElement | null;
                if (!currentSection) {
                    const next = findClosestInDirection(current, all, direction);
                    if (next) focusElement(next);
                    return;
                }

                const sIdx = sections.indexOf(currentSection);
                const targetIdx = direction === "up" ? sIdx - 1 : sIdx + 1;
                if (targetIdx < 0 || targetIdx >= sections.length) return;

                const targetSection = sections[targetIdx];
                const candidates = getFocusablesInSection(targetSection);
                if (candidates.length === 0) return;

                const curRect = current.getBoundingClientRect();
                const curCx = curRect.left + curRect.width / 2;
                let best = candidates[0];
                let bestDx = Infinity;
                for (const c of candidates) {
                    const r = c.getBoundingClientRect();
                    const dx = Math.abs(r.left + r.width / 2 - curCx);
                    if (dx < bestDx) { bestDx = dx; best = c; }
                }
                focusElement(best);
            }
        },
        [getAllFocusable, getSections, getFocusablesInSection, focusElement, findClosestInDirection]
    );

    // ── Video control helpers ──
    const videoTogglePlay = useCallback(() => {
        const video = getActiveVideo();
        if (!video) return false;
        if (video.paused) video.play().catch(() => {});
        else video.pause();
        return true;
    }, [getActiveVideo]);

    const videoSeek = useCallback((delta: number) => {
        const video = getActiveVideo();
        if (!video) return false;
        video.currentTime = Math.max(0, Math.min(video.currentTime + delta, video.duration || 0));
        return true;
    }, [getActiveVideo]);

    const videoVolume = useCallback((delta: number) => {
        const video = getActiveVideo();
        if (!video) return false;
        video.volume = Math.max(0, Math.min(1, video.volume + delta));
        return true;
    }, [getActiveVideo]);

    const videoFullscreen = useCallback(() => {
        window.dispatchEvent(new CustomEvent("device-sync-fullscreen"));
    }, []);

    const videoNavigate = useCallback((direction: "next" | "previous") => {
        window.dispatchEvent(new CustomEvent("device-sync-navigate", { detail: { direction } }));
    }, []);

    // ── Keyboard handler ──
    useEffect(() => {
        if (!tvMode) return;

        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    if (getActiveVideo()) videoSeek(-5);
                    else handleNavigation("left");
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    if (getActiveVideo()) videoSeek(5);
                    else handleNavigation("right");
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    if (getActiveVideo()) videoVolume(0.05);
                    else handleNavigation("up");
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    if (getActiveVideo()) videoVolume(-0.05);
                    else handleNavigation("down");
                    break;
                case "Enter":
                case " ": {
                    const focused = document.activeElement as HTMLElement;
                    if (focused?.hasAttribute("data-tv-focusable")) {
                        e.preventDefault();
                        focused.click();
                    }
                    break;
                }
                case "Backspace":
                case "Escape":
                    e.preventDefault();
                    window.history.back();
                    break;
                // ── Media remote / CEC keys ──
                case "MediaPlayPause":
                    e.preventDefault();
                    videoTogglePlay();
                    break;
                case "MediaPlay":
                    e.preventDefault();
                    getActiveVideo()?.play().catch(() => {});
                    break;
                case "MediaPause":
                    e.preventDefault();
                    getActiveVideo()?.pause();
                    break;
                case "MediaStop":
                    e.preventDefault();
                    { const v = getActiveVideo(); if (v) { v.pause(); v.currentTime = 0; } }
                    break;
                case "MediaTrackNext":
                    e.preventDefault();
                    videoNavigate("next");
                    break;
                case "MediaTrackPrevious":
                    e.preventDefault();
                    videoNavigate("previous");
                    break;
                case "MediaRewind":
                case "MediaFastForward":
                    e.preventDefault();
                    videoSeek(e.key === "MediaFastForward" ? 30 : -30);
                    break;
                case "AudioVolumeUp":
                    e.preventDefault();
                    videoVolume(0.05);
                    break;
                case "AudioVolumeDown":
                    e.preventDefault();
                    videoVolume(-0.05);
                    break;
                case "AudioVolumeMute":
                    e.preventDefault();
                    { const v = getActiveVideo(); if (v) v.muted = !v.muted; }
                    break;
            }
        };

        window.addEventListener("keydown", handler, { capture: true });
        return () => window.removeEventListener("keydown", handler, { capture: true });
    }, [tvMode, handleNavigation, getActiveVideo, videoTogglePlay, videoSeek, videoVolume, videoNavigate]);

    // ── Gamepad polling ──
    useEffect(() => {
        if (!tvMode) return;

        let rafId: number;
        const prevButtons = new Map<number, boolean[]>();

        // D-pad repeat with acceleration: starts at 300ms, speeds up to 120ms after 3 presses
        const INITIAL_REPEAT = 300;
        const FAST_REPEAT = 120;
        const FAST_AFTER = 3;
        const repeatCount: Record<string, number> = { left: 0, right: 0, up: 0, down: 0 };
        const lastPress: Record<string, number> = { left: 0, right: 0, up: 0, down: 0 };

        const dpadMap: Record<number, "up" | "down" | "left" | "right"> = {
            12: "up", 13: "down", 14: "left", 15: "right",
        };

        const poll = () => {
            const gamepads = navigator.getGamepads?.();
            if (!gamepads) { rafId = requestAnimationFrame(poll); return; }

            const now = Date.now();
            const hasVideo = !!getActiveVideo();

            for (const gp of gamepads) {
                if (!gp) continue;

                const prev = prevButtons.get(gp.index) ?? [];
                const cur = gp.buttons.map((b) => b.pressed);

                // D-pad with repeat acceleration
                for (const [btnIdx, dir] of Object.entries(dpadMap)) {
                    const idx = Number(btnIdx);
                    if (cur[idx]) {
                        const delay = repeatCount[dir] >= FAST_AFTER ? FAST_REPEAT : INITIAL_REPEAT;
                        if (!prev[idx] || now - lastPress[dir] > delay) {
                            lastPress[dir] = now;
                            repeatCount[dir]++;

                            // If video is active, D-pad left/right seeks ±5s
                            if (hasVideo && (dir === "left" || dir === "right")) {
                                videoSeek(dir === "right" ? 5 : -5);
                            } else if (hasVideo && (dir === "up" || dir === "down")) {
                                videoVolume(dir === "up" ? 0.05 : -0.05);
                            } else {
                                handleNavigation(dir);
                            }
                        }
                    } else if (prev[idx]) {
                        // Released — reset repeat counter
                        repeatCount[dir] = 0;
                    }
                }

                // Left stick
                const lx = gp.axes[0] ?? 0;
                const ly = gp.axes[1] ?? 0;
                const threshold = 0.5;
                if (Math.abs(lx) > threshold || Math.abs(ly) > threshold) {
                    const dir = Math.abs(lx) > Math.abs(ly)
                        ? (lx > 0 ? "right" : "left")
                        : (ly > 0 ? "down" : "up");
                    const delay = repeatCount[dir] >= FAST_AFTER ? FAST_REPEAT : INITIAL_REPEAT;
                    if (now - lastPress[dir] > delay) {
                        lastPress[dir] = now;
                        repeatCount[dir]++;
                        if (!hasVideo) handleNavigation(dir);
                    }
                } else {
                    // Stick centered — reset all stick repeat counters
                    if (Math.abs(lx) < 0.2 && Math.abs(ly) < 0.2) {
                        for (const d of ["left", "right", "up", "down"]) {
                            if (repeatCount[d] > 0 && !cur[dpadMap[d === "up" ? 12 : d === "down" ? 13 : d === "left" ? 14 : 15] as unknown as number]) {
                                // Only reset if dpad for this dir is also not pressed
                            }
                        }
                    }
                }

                // A button (0) = Select
                if (cur[0] && !prev[0]) {
                    if (hasVideo) {
                        videoTogglePlay();
                    } else {
                        const focused = document.activeElement as HTMLElement;
                        if (focused?.hasAttribute("data-tv-focusable")) focused.click();
                    }
                }

                // B button (1) = Back
                if (cur[1] && !prev[1]) {
                    window.history.back();
                }

                // X button (2) = Play/Pause (video) or click focused
                if (cur[2] && !prev[2]) {
                    videoTogglePlay();
                }

                // Y button (3) = Fullscreen toggle (video)
                if (cur[3] && !prev[3]) {
                    if (hasVideo) videoFullscreen();
                }

                // LB (4) = Previous episode / jump to prev section
                if (cur[4] && !prev[4]) {
                    if (hasVideo) {
                        videoNavigate("previous");
                    } else {
                        // Jump to previous section
                        handleNavigation("up");
                    }
                }

                // RB (5) = Next episode / jump to next section
                if (cur[5] && !prev[5]) {
                    if (hasVideo) {
                        videoNavigate("next");
                    } else {
                        handleNavigation("down");
                    }
                }

                // LT (6) = Seek -30s
                if (cur[6] && !prev[6]) {
                    videoSeek(-30);
                }

                // RT (7) = Seek +30s
                if (cur[7] && !prev[7]) {
                    videoSeek(30);
                }

                // Start (9) = Toggle play/pause
                if (cur[9] && !prev[9]) {
                    videoTogglePlay();
                }

                // Guide (16) = Toggle TV mode
                if (cur[16] && !prev[16]) {
                    useSettingsStore.getState().set("tvMode", !useSettingsStore.getState().settings.tvMode);
                }

                prevButtons.set(gp.index, cur);
            }

            rafId = requestAnimationFrame(poll);
        };

        rafId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafId);
    }, [tvMode, handleNavigation, getActiveVideo, videoTogglePlay, videoSeek, videoVolume, videoFullscreen, videoNavigate]);

    // Auto-focus first focusable element on route changes
    useEffect(() => {
        if (!tvMode) return;
        const timer = setTimeout(() => {
            const active = document.activeElement as HTMLElement;
            if (!active?.hasAttribute("data-tv-focusable")) {
                const first = getAllFocusable()[0];
                if (first) focusElement(first);
            }
        }, 600);
        return () => clearTimeout(timer);
    }, [tvMode, pathname, getAllFocusable, focusElement]);

    return { handleNavigation };
}
