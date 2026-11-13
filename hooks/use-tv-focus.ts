"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSettingsStore } from "@/lib/stores/settings";
import { useDevice } from "@/components/device/device-provider";
import { closestInDirection, restoreFocusIndex } from "@/components/tv/focus-selection";

/**
 * Spatial navigation for TV mode.
 * Arrow keys / gamepad D-pad move focus between `[data-tv-focusable]` elements.
 * Focus is scoped to sections (`[data-tv-section]`) for up/down,
 * and individual items within a section for left/right.
 *
 * Gamepad mapping (Standard layout):
 *   D-pad / Left stick — Navigate
 *   Right stick — Custom cursor mode
 *   A (0)  — Select/click (or click under cursor)
 *   B (1)  — Back
 *   X (2)  — Play/pause (when video active)
 *   Y (3)  — Toggle fullscreen (when video active)
 *   LB (4) — Previous section / seek -10s
 *   RB (5) — Next section / seek +10s
 *   LT (6) — Seek -30s (when video active)
 *   RT (7) — Seek +30s (when video active)
 *   View (8) — Search (when no video is playing)
 *   Start (9) — Toggle play/pause
 *   Guide (16) — Toggle Big Picture mode
 */
export function useTVFocus() {
    const savedTVMode = useSettingsStore((s) => s.settings.tvMode);
    const { isTV, isPhone } = useDevice();
    const tvMode = !isPhone && (isTV || savedTVMode);
    const pathname = usePathname();
    const lastFocusedRef = useRef<HTMLElement | null>(null);
    const pageFocusRef = useRef(new Map<string, { key: string; index: number }>());
    
    // Cursor position and visibility for right stick mode
    const [cursorX, setCursorX] = useState(() => typeof window === "undefined" ? 0 : window.innerWidth / 2);
    const [cursorY, setCursorY] = useState(() => typeof window === "undefined" ? 0 : window.innerHeight / 2);
    const [cursorVisible, setCursorVisible] = useState(false);
    const [cursorHovering, setCursorHovering] = useState(false);

    // Refs for accessing cursor state in gamepad polling without causing re-renders
    const cursorPosRef = useRef({ x: 0, y: 0 });
    const cursorVisibleRef = useRef(false);
    const cursorHoveringRef = useRef(false);
    const prevHoveredEl = useRef<HTMLElement | null>(null);
    const cursorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [cursorTargetRect, setCursorTargetRect] = useState<{ left: number; top: number; width: number; height: number; borderRadius: string } | null>(null);
    const prevCursorRectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

    // Detect if a video is currently playing in the preview
    const getActiveVideo = useCallback((): HTMLVideoElement | null => {
        return document.querySelector("video");
    }, []);

    // Use getBoundingClientRect instead of offsetParent — correctly includes
    // position:fixed elements (e.g. the TV nav bar at the top of the page).
    const isVisible = useCallback((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        // A closed trigger/collapsible remains visible; only closed overlay content is excluded.
        let node: HTMLElement | null = el;
        while (node && node !== document.body) {
            const style = getComputedStyle(node);
            if (style.visibility === "hidden" || node.hidden || node.inert || node.getAttribute("aria-hidden") === "true") return false;
            if (node.getAttribute("data-state") === "closed" && node.matches('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return false;
            if (style.opacity === "0" && node.closest(".debridui-legacy-player")) return false;
            node = node.parentElement;
        }
        return true;
    }, []);

    const getScope = useCallback(() => {
        const layers = Array.from(document.querySelectorAll<HTMLElement>(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .debridui-legacy-player'
        )).filter(isVisible);
        return layers.at(-1) ?? null;
    }, [isVisible]);

    const getAllFocusable = useCallback(() => {
        const scope = getScope();
        // Portalled Radix controls (including built-in close buttons) need to join
        // spatial navigation without changing the shared primitives for desktop.
        const root = scope ?? document.getElementById("tv-mode-root") ?? document.body;
        return Array.from(root.querySelectorAll<HTMLElement>(
            '[data-tv-focusable], button, a[href], input, textarea, select, [role="menuitem"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"]'
        )).filter((el) => (el.matches('button, a[href], input, textarea, select, [tabindex]')) && !el.matches('[disabled], [aria-disabled="true"], [data-disabled], input[type="hidden"]') && isVisible(el));
    }, [getScope, isVisible]);

    const getFocusablesInSection = useCallback((section: HTMLElement) => {
        return getAllFocusable().filter((el) => section.contains(el));
    }, [getAllFocusable]);

    const focusElement = useCallback((el: HTMLElement | null) => {
        if (!el) return;
        el.focus({ preventScroll: true });
        // Settle every move, including rapid key repeats, in nested horizontal rails.
        el.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
        lastFocusedRef.current = el;
    }, []);

    const findClosestInDirection = useCallback(
        (current: HTMLElement, items: HTMLElement[], direction: "left" | "right" | "up" | "down") => {
            const candidates = items.filter((item) => item !== current);
            const index = closestInDirection(current.getBoundingClientRect(), candidates.map((item) => item.getBoundingClientRect()), direction);
            return candidates[index] ?? null;
        }, []
    );

    const handleBack = useCallback(() => {
        const scope = getScope();
        if (scope?.getAttribute("role") === "alertdialog") {
            scope.querySelector<HTMLElement>('[data-slot="alert-dialog-cancel"]')?.click();
        } else if (scope) {
            // Let Radix close the top layer and run its own restore-focus handler.
            document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        } else {
            window.history.back();
        }
    }, [getScope]);

    const activate = useCallback((el: HTMLElement) => {
        if (el.matches('[data-slot="select-trigger"], [data-slot="dropdown-menu-trigger"], [role="menuitem"], [role="option"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"]')) {
            const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            if (!event.defaultPrevented) el.click();
        } else {
            el.click();
        }
    }, []);

    const isInNavigation = useCallback((el: HTMLElement) => !!el.closest(".tv-nav-bar"), []);

    const handleNavigation = useCallback(
        (direction: "left" | "right" | "up" | "down") => {
            const current = document.activeElement as HTMLElement;
            const all = getAllFocusable();

            if (!all.includes(current)) {
                // Auto-focus: if the player is active (fullscreen fixed container), prefer its buttons first.
                const playerContainer = document.querySelector(".debridui-legacy-player");
                if (playerContainer) {
                    const playerItems = all.filter((el) => playerContainer.contains(el));
                    if (playerItems.length > 0) {
                        focusElement(playerItems[0]);
                        return;
                    }
                }
                // Fallback: pick primary content before the top navigation.
                const firstContent = all.find((el) => !isInNavigation(el));
                focusElement(firstContent ?? all[0] ?? null);
                return;
            }

            if (getScope()) {
                const next = findClosestInDirection(current, all, direction);
                if (next) focusElement(next);
                return;
            }

            if (direction === "left" || direction === "right") {
                const playerContainer = document.querySelector(".debridui-legacy-player");
                const currentInPlayer = !!playerContainer && playerContainer.contains(current);
                if (currentInPlayer) {
                    const playerItems = all.filter((el) => playerContainer!.contains(el));
                    const next = findClosestInDirection(current, playerItems, direction);
                    if (next) focusElement(next);
                } else {
                    const section = current.closest("[data-tv-section]") as HTMLElement | null;
                    const nav = current.closest(".tv-nav-bar");
                    const pool = nav ? all.filter((el) => nav.contains(el)) : section ? getFocusablesInSection(section) : all;
                    const next = findClosestInDirection(current, pool, direction);
                    if (next) focusElement(next);
                }
            } else {
                const currentIsFixed = isInNavigation(current);
                const playerContainer = document.querySelector(".debridui-legacy-player");
                const currentInPlayer = !!playerContainer && playerContainer.contains(current);

                // Only the top navigation is a separate layer; bottom action bars are content.
                const contentItems = all.filter((el) => !isInNavigation(el));
                const fixedItems = all.filter((el) => isInNavigation(el));

                if (currentInPlayer) {
                    // Inside player: navigate within player items only.
                    const playerItems = all.filter((el) => playerContainer!.contains(el));
                    const next = findClosestInDirection(current, playerItems, direction);
                    if (next) focusElement(next);
                } else if (currentIsFixed) {
                    // In nav bar → up does nothing (already topmost);
                    // down goes to first content item below.
                    if (direction === "up") return;
                    const next = findClosestInDirection(current, contentItems, direction);
                    if (next) focusElement(next);
                } else {
                    // In content → try content-only first so we skip the nav bar.
                    // Only fall through to fixed layer when nothing above in content.
                    const next = findClosestInDirection(current, contentItems, direction)
                        ?? (direction === "up" ? findClosestInDirection(current, fixedItems, direction) : null);
                    if (next) focusElement(next);
                }
            }
        },
        [getAllFocusable, getFocusablesInSection, focusElement, findClosestInDirection, isInNavigation, getScope]
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
        window.dispatchEvent(new CustomEvent("debridui-player-seek", { detail: { delta } }));
        return true;
    }, [getActiveVideo]);

    const videoVolume = useCallback((delta: number) => {
        const video = getActiveVideo();
        if (!video) return false;
        window.dispatchEvent(new CustomEvent("debridui-player-volume", { detail: { delta } }));
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
            const target = e.target as HTMLElement;
            const tag = target.tagName;
            if (e.key === "BrowserBack" || e.key === "GoBack") {
                e.preventDefault();
                handleBack();
                return;
            }
            if (tag === "SELECT") return;
            if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
                // The platform keyboard handles its own arrows. Arrows delivered
                // to the page must let a remote leave the field for adjacent actions.
                const direction = { ArrowDown: "down", ArrowUp: "up", ArrowLeft: "left", ArrowRight: "right" } as const;
                if (!(e.key in direction)) return;
                e.preventDefault();
                handleNavigation(direction[e.key as keyof typeof direction]);
                return;
            }
            // Native Radix menus/selects own keyboard activation and dismissal.
            if (target.closest('[role="menu"], [role="listbox"]')) return;
            if ((e.key === "Escape" || e.key === "Backspace") && getScope()) {
                if (e.key === "Backspace" || getScope()?.getAttribute("role") === "alertdialog") { e.preventDefault(); handleBack(); }
                return;
            }

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    if (getActiveVideo() && !getAllFocusable().includes(target)) videoSeek(-5);
                    else handleNavigation("left");
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    if (getActiveVideo() && !getAllFocusable().includes(target)) videoSeek(5);
                    else handleNavigation("right");
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    if (getActiveVideo() && !getAllFocusable().includes(target)) videoVolume(0.05);
                    else handleNavigation("up");
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    if (getActiveVideo() && !getAllFocusable().includes(target)) videoVolume(-0.05);
                    else handleNavigation("down");
                    break;
                case "Enter":
                case " ": {
                    const focused = document.activeElement as HTMLElement;
                    if (focused && getAllFocusable().includes(focused)) {
                        if (focused.matches('button, a[href], [role="tab"], [role="checkbox"], [role="switch"]')) return;
                        e.preventDefault();
                        activate(focused);
                    }
                    break;
                }
                case "Backspace":
                case "Escape":
                    e.preventDefault();
                    handleBack();
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
    }, [tvMode, handleNavigation, getActiveVideo, videoTogglePlay, videoSeek, videoVolume, videoNavigate, getScope, getAllFocusable, handleBack, activate]);

    // ── Gamepad polling ──
    useEffect(() => {
        if (!tvMode) return;

        let rafId: number;
        let lastProcessedAt = 0;
        const prevButtons = new Map<number, boolean[]>();
        const FRAME_INTERVAL_MS = 1000 / 30;

        // Cache video element to avoid DOM queries every frame (~60/s)
        let cachedVideo: HTMLVideoElement | null = null;
        let lastVideoCheck = 0;
        const VIDEO_CHECK_MS = 500;

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
            const frameNow = performance.now();
            if (document.hidden || frameNow - lastProcessedAt < FRAME_INTERVAL_MS) {
                rafId = requestAnimationFrame(poll);
                return;
            }
            lastProcessedAt = frameNow;

            const gamepads = navigator.getGamepads?.();
            if (!gamepads) { rafId = requestAnimationFrame(poll); return; }

            const now = Date.now();

            // Re-query DOM only every 500ms instead of every frame
            if (now - lastVideoCheck > VIDEO_CHECK_MS) {
                cachedVideo = document.querySelector("video");
                lastVideoCheck = now;
            }
            const hasVideo = !!cachedVideo;

            // Collect whether any gamepad input is active this frame
            let anyInput = false;

            // Check if the player controls bar is currently hidden (opacity:0).
            // When hidden, the first D-pad press should reveal them rather than navigate.
            const playerControlsHidden = (() => {
                if (!cachedVideo) return false;
                const container = cachedVideo.closest(".debridui-legacy-player");
                if (!container) return false;
                const bar = container.querySelector("[data-player-controls]");
                if (!bar) return false;
                // Walk up from the bar to find any ancestor with opacity:0
                let node: Element | null = bar.parentElement;
                while (node && node !== container) {
                    if (getComputedStyle(node as HTMLElement).opacity === "0") return true;
                    node = node.parentElement;
                }
                return false;
            })();

            for (const gp of gamepads) {
                if (!gp) continue;

                const prev = prevButtons.get(gp.index) ?? [];
                const cur = gp.buttons.map((b) => b.pressed);

                // ── D-pad: UI navigation ONLY (never video seek/volume) ──
                // Clear cursor mode on first press so both inputs never interfere.
                for (const [btnIdx, dir] of Object.entries(dpadMap)) {
                    const idx = Number(btnIdx);
                    if (cur[idx]) {
                        anyInput = true;
                        const delay = repeatCount[dir] >= FAST_AFTER ? FAST_REPEAT : INITIAL_REPEAT;
                        if (!prev[idx] || now - lastPress[dir] > delay) {
                            lastPress[dir] = now;
                            repeatCount[dir]++;

                            // First press while cursor is visible → dismiss cursor/blob
                            if (!prev[idx] && cursorVisibleRef.current) {
                                if (cursorHideTimerRef.current) { clearTimeout(cursorHideTimerRef.current); cursorHideTimerRef.current = null; }
                                cursorVisibleRef.current = false; setCursorVisible(false);
                                cursorHoveringRef.current = false; setCursorHovering(false);
                                prevHoveredEl.current?.removeAttribute("data-tv-cursor-over");
                                prevHoveredEl.current = null;
                                prevCursorRectRef.current = null; setCursorTargetRect(null);
                                // Don't navigate on cursor-dismiss press
                                continue;
                            }

                            // Player controls hidden → first press wakes them, don't navigate yet
                            if (!prev[idx] && playerControlsHidden) {
                                // The anyInput flag below will trigger the mousemove wakeup
                                continue;
                            }

                            handleNavigation(dir);
                        }
                    } else if (prev[idx]) {
                        repeatCount[dir] = 0;
                    }
                }

                // ── Left stick: navigation + video control + page scroll ──
                // D-pad axes (axes[6]/axes[7] on many PS/Xbox controllers)
                const lx = gp.axes[0] ?? 0;
                const ly = gp.axes[1] ?? 0;
                const dax = gp.axes[6] ?? 0;
                const day = gp.axes[7] ?? 0;
                const ax = Math.abs(dax) > 0.5 ? dax : lx;
                const ay = Math.abs(day) > 0.5 ? day : ly;
                const threshold = 0.5;
                if (Math.abs(ax) > threshold || Math.abs(ay) > threshold) {
                    anyInput = true;
                    const dir = Math.abs(ax) > Math.abs(ay)
                        ? (ax > 0 ? "right" : "left")
                        : (ay > 0 ? "down" : "up");
                    const delay = repeatCount[dir] >= FAST_AFTER ? FAST_REPEAT : INITIAL_REPEAT;
                    if (now - lastPress[dir] > delay) {
                        lastPress[dir] = now;
                        repeatCount[dir]++;

                        const stickFocused = document.activeElement as HTMLElement;
                        if (stickFocused?.hasAttribute("data-tv-focusable")) {
                            // Focused element: navigate it (even if video is active)
                            handleNavigation(dir);
                        } else if (hasVideo && (dir === "left" || dir === "right")) {
                            videoSeek(dir === "right" ? 5 : -5);
                        } else if (hasVideo && (dir === "up" || dir === "down")) {
                            videoVolume(dir === "up" ? 0.05 : -0.05);
                        } else {
                            // Nothing focused — instant-scroll the page
                            const scrollAmount = 120;
                            const dy = dir === "down" ? scrollAmount : dir === "up" ? -scrollAmount : 0;
                            const dx = dir === "right" ? scrollAmount : dir === "left" ? -scrollAmount : 0;
                            window.scrollBy({ top: dy, left: dx, behavior: "instant" });
                        }
                    }
                }

                // Right stick for cursor movement
                const rx = gp.axes[2] ?? 0;
                const ry = gp.axes[3] ?? 0;
                const cursorThreshold = 0.1;
                if (Math.abs(rx) > cursorThreshold || Math.abs(ry) > cursorThreshold) {
                    anyInput = true;
                    // Cancel any pending hide timer
                    if (cursorHideTimerRef.current) {
                        clearTimeout(cursorHideTimerRef.current);
                        cursorHideTimerRef.current = null;
                    }

                    // On first activation: snap cursor to the focused element's center
                    // so cursor and D-pad always start from the same position
                    if (!cursorVisibleRef.current) {
                        const focused = document.activeElement as HTMLElement;
                        if (focused && getAllFocusable().includes(focused)) {
                            const fr = focused.getBoundingClientRect();
                            const sx = fr.left + fr.width / 2;
                            const sy = fr.top + fr.height / 2;
                            cursorPosRef.current = { x: sx, y: sy };
                            setCursorX(sx);
                            setCursorY(sy);
                        }
                    }

                    cursorVisibleRef.current = true;
                    setCursorVisible(true);

                    // Normalize past deadzone then apply quadratic curve:
                    // slow + precise near center, fast near full tilt.
                    const norm = (v: number) => {
                        if (Math.abs(v) <= cursorThreshold) return 0;
                        const sign = v < 0 ? -1 : 1;
                        const n = (Math.abs(v) - cursorThreshold) / (1 - cursorThreshold);
                        return sign * n * n;
                    };
                    const maxSpeed = 22;
                    const newX = Math.max(0, Math.min(window.innerWidth, cursorPosRef.current.x + norm(rx) * maxSpeed));
                    const newY = Math.max(0, Math.min(window.innerHeight, cursorPosRef.current.y + norm(ry) * maxSpeed));
                    cursorPosRef.current = { x: newX, y: newY };
                    setCursorX(newX);
                    setCursorY(newY);

                    // Hover detection: find nearest interactive ancestor under cursor.
                    // Only match truly interactive elements — not generic focusable containers.
                    // Walk from elementFromPoint (may be SVG/text) up to first HTMLElement.
                    const elUnder = document.elementFromPoint(newX, newY);
                    let interactiveEl: HTMLElement | null = null;
                    if (elUnder) {
                        let node: Element | null = elUnder;
                        while (node && node !== document.body) {
                            if (!(node instanceof HTMLElement)) { node = node.parentElement; continue; }
                            const tag = node.tagName;
                            const role = node.getAttribute("role");
                            if (
                                node.hasAttribute("data-tv-focusable") ||
                                tag === "BUTTON" || tag === "INPUT" ||
                                tag === "SELECT" || tag === "TEXTAREA" ||
                                (tag === "A" && node.hasAttribute("href")) ||
                                role === "button" || role === "menuitem" ||
                                role === "option" || role === "tab"
                            ) {
                                if (getComputedStyle(node).pointerEvents !== "none") {
                                    interactiveEl = node;
                                    break;
                                }
                            }
                            node = node.parentElement;
                        }
                    }

                    if (prevHoveredEl.current !== interactiveEl) {
                        prevHoveredEl.current?.removeAttribute("data-tv-cursor-over");
                        interactiveEl?.setAttribute("data-tv-cursor-over", "");
                        prevHoveredEl.current = interactiveEl;
                        const nowHovering = interactiveEl !== null;
                        if (cursorHoveringRef.current !== nowHovering) {
                            cursorHoveringRef.current = nowHovering;
                            setCursorHovering(nowHovering);
                        }
                        // Sync cursor hover → D-pad focus so A always acts on the same element
                        if (interactiveEl?.hasAttribute("data-tv-focusable")) {
                            interactiveEl.focus({ preventScroll: true });
                        }
                    }

                    // Update target rect every frame for scroll-tracking accuracy.
                    // Use Math.round to skip sub-pixel churn and avoid unnecessary re-renders.
                    if (interactiveEl) {
                        const r = interactiveEl.getBoundingClientRect();
                        const rl = Math.round(r.left), rt = Math.round(r.top);
                        const rw = Math.round(r.width), rh = Math.round(r.height);
                        const prev = prevCursorRectRef.current;
                        if (!prev || prev.left !== rl || prev.top !== rt || prev.width !== rw || prev.height !== rh) {
                            prevCursorRectRef.current = { left: rl, top: rt, width: rw, height: rh };
                            setCursorTargetRect({
                                left: rl, top: rt, width: rw, height: rh,
                                borderRadius: getComputedStyle(interactiveEl).borderRadius,
                            });
                        }
                    } else if (prevCursorRectRef.current !== null) {
                        prevCursorRectRef.current = null;
                        setCursorTargetRect(null);
                    }

                    // Dispatch a synthetic mousemove so the video player's control-bar
                    // auto-hide timer keeps resetting while the cursor is moving.
                    document.dispatchEvent(new MouseEvent("mousemove", {
                        bubbles: true, cancelable: false,
                        clientX: newX, clientY: newY,
                    }));

                    // Edge scroll: instant, proportional to edge proximity × overall stick magnitude.
                    // Triggers whenever the stick is active AND cursor is in the edge zone —
                    // regardless of stick direction (any active input while at edge = scroll).
                    const edgeZone = 160;
                    const maxScrollPerFrame = 28;
                    const stickMag = Math.sqrt(rx * rx + ry * ry);
                    let scrollDY = 0, scrollDX = 0;
                    if (stickMag > cursorThreshold) {
                        if (newY < edgeZone) {
                            scrollDY = -Math.ceil((1 - newY / edgeZone) * stickMag * maxScrollPerFrame);
                        } else if (newY > window.innerHeight - edgeZone) {
                            scrollDY = Math.ceil((1 - (window.innerHeight - newY) / edgeZone) * stickMag * maxScrollPerFrame);
                        }
                        if (newX < edgeZone) {
                            scrollDX = -Math.ceil((1 - newX / edgeZone) * stickMag * maxScrollPerFrame);
                        } else if (newX > window.innerWidth - edgeZone) {
                            scrollDX = Math.ceil((1 - (window.innerWidth - newX) / edgeZone) * stickMag * maxScrollPerFrame);
                        }
                        if (scrollDY !== 0 || scrollDX !== 0) {
                            // behavior "instant" explicitly overrides CSS scroll-behavior: smooth
                            window.scrollBy({ top: scrollDY, left: scrollDX, behavior: "instant" });
                        }
                    }
                } else {
                    // Schedule a single hide timer (not once per-frame) after 2s of inactivity
                    if (cursorVisibleRef.current && !cursorHideTimerRef.current) {
                        cursorHideTimerRef.current = setTimeout(() => {
                            cursorHideTimerRef.current = null;
                            cursorVisibleRef.current = false;
                            setCursorVisible(false);
                            cursorHoveringRef.current = false;
                            setCursorHovering(false);
                            prevHoveredEl.current?.removeAttribute("data-tv-cursor-over");
                            prevHoveredEl.current = null;
                        }, 2000);
                    }
                }

                // A button (0) = Select/confirm.
                // Priority: cursor click > focused element > video play/pause fallback.
                if (cur[0] && !prev[0]) {
                    anyInput = true;
                    if (cursorHoveringRef.current) {
                        const cx = cursorPosRef.current.x;
                        const cy = cursorPosRef.current.y;
                        // prevHoveredEl is always HTMLElement; fallback walks up from elementFromPoint
                        // to skip SVG sub-elements that have no .click()
                        let target: HTMLElement | null = prevHoveredEl.current;
                        if (!target) {
                            let el: Element | null = document.elementFromPoint(cx, cy);
                            while (el && el !== document.body) {
                                if (el instanceof HTMLElement) { target = el; break; }
                                el = el.parentElement;
                            }
                        }
                        const scope = getScope();
                        if (target && scope && !scope.contains(target)) target = null;
                        if (target) {
                            // Fire full pointer event sequence at cursor position so seekbar,
                            // Radix dropdowns, and other pointer-driven widgets respond correctly.
                            const opts: PointerEventInit = {
                                bubbles: true, cancelable: true,
                                isPrimary: true, pointerId: 1,
                                pointerType: "mouse", button: 0, buttons: 1,
                                clientX: cx, clientY: cy,
                            };
                            target.dispatchEvent(new PointerEvent("pointerover", opts));
                            target.dispatchEvent(new PointerEvent("pointerenter", { ...opts, bubbles: false }));
                            target.dispatchEvent(new PointerEvent("pointerdown", opts));
                            target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 }));
                            setTimeout(() => {
                                target!.dispatchEvent(new PointerEvent("pointerup", opts));
                                target!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 }));
                                target!.click();
                            }, 0);
                            // Visual feedback: briefly clear cursor
                            prevHoveredEl.current?.removeAttribute("data-tv-cursor-over");
                            prevHoveredEl.current = null;
                            cursorHoveringRef.current = false;
                            setCursorHovering(false);
                            cursorVisibleRef.current = false;
                            setCursorVisible(false);
                            setTimeout(() => {
                                cursorVisibleRef.current = true;
                                setCursorVisible(true);
                            }, 150);
                        }
                    } else {
                        // No cursor: focused element takes priority over video play/pause
                        const focused = document.activeElement as HTMLElement;
                        if (focused && getAllFocusable().includes(focused)) {
                            activate(focused);
                        } else if (hasVideo) {
                            videoTogglePlay();
                        }
                    }
                }

                // B button (1) = Back
                if (cur[1] && !prev[1]) {
                    handleBack();
                }

                // X button (2) = Play/Pause (video) or click focused
                if (cur[2] && !prev[2]) {
                    anyInput = true;
                    videoTogglePlay();
                }

                // Y button (3) = Fullscreen toggle (video)
                if (cur[3] && !prev[3]) {
                    anyInput = true;
                    if (hasVideo) videoFullscreen();
                }

                // LB (4) = Previous episode / jump to prev section
                if (cur[4] && !prev[4]) {
                    anyInput = true;
                    if (hasVideo) {
                        videoNavigate("previous");
                    } else {
                        // Jump to previous section
                        handleNavigation("up");
                    }
                }

                // RB (5) = Next episode / jump to next section
                if (cur[5] && !prev[5]) {
                    anyInput = true;
                    if (hasVideo) {
                        videoNavigate("next");
                    } else {
                        handleNavigation("down");
                    }
                }

                // LT (6) = Seek -30s
                if (cur[6] && !prev[6]) {
                    anyInput = true;
                    videoSeek(-30);
                }

                // RT (7) = Seek +30s
                if (cur[7] && !prev[7]) {
                    anyInput = true;
                    videoSeek(30);
                }

                // View/Back (8) = Search, like a console dashboard's search key
                if (cur[8] && !prev[8] && !cachedVideo) {
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true, bubbles: true }));
                }

                // Start (9) = Toggle play/pause
                if (cur[9] && !prev[9]) {
                    videoTogglePlay();
                }

                // Guide (16) = Toggle TV mode
                if (cur[16] && !prev[16] && !isTV) {
                    useSettingsStore.getState().set("tvMode", !useSettingsStore.getState().settings.tvMode);
                }

                prevButtons.set(gp.index, cur);
            }

            // Any gamepad input → wake up player controls by dispatching mousemove
            // to the player container. The legacy video player listens to 'mousemove'
            // on its container to reset the 3s auto-hide timer.
            if (anyInput && cachedVideo) {
                const container = cachedVideo.closest(".debridui-legacy-player");
                if (container) {
                    container.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: false }));
                }
            }

            rafId = requestAnimationFrame(poll);
        };

        rafId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafId);
    }, [tvMode, handleNavigation, videoTogglePlay, videoSeek, videoVolume, videoFullscreen, videoNavigate, getAllFocusable, getScope, handleBack, isTV, activate]);

    // Keep route memories independent of DOM instances: Next remounts cards on Back.
    useEffect(() => {
        if (!tvMode) return;
        const keyFor = (el: HTMLElement) => el.dataset.tvFocusKey || el.getAttribute("href") || el.id || `${el.closest("[data-tv-section]")?.getAttribute("data-tv-section") ?? ""}:${el.getAttribute("aria-label") ?? ""}:${el.textContent?.trim()}`;
        const remember = (event: FocusEvent) => {
            if (window.location.pathname !== pathname) return;
            const el = event.target as HTMLElement;
            if (!getScope()) lastFocusedRef.current = el;
            if (getScope() || el.closest(".tv-nav-bar")) return;
            const items = getAllFocusable().filter((item) => !item.closest(".tv-nav-bar"));
            const index = items.indexOf(el);
            if (index >= 0) pageFocusRef.current.set(pathname, { key: keyFor(el), index });
        };
        let pending = true;
        const saved = pageFocusRef.current.get(pathname);
        const restoreDeadline = Date.now() + 2000;
        let previousScope: HTMLElement | null = null;
        let lastActive = document.activeElement as HTMLElement | null;
        const openers = new Map<HTMLElement, HTMLElement | null>();
        let frame = 0;
        const sync = () => {
            const scope = getScope();
            if (scope !== previousScope) {
                if (scope && !openers.has(scope)) openers.set(scope, lastFocusedRef.current);
                const opener = previousScope && openers.get(previousScope);
                if (previousScope && opener?.isConnected && (!scope || scope.contains(opener))) focusElement(opener);
                previousScope = scope;
                if (scope && !scope.contains(document.activeElement)) focusElement(getAllFocusable()[0] ?? null);
            }
            const items = getAllFocusable();
            for (const el of items) {
                if (!el.hasAttribute("data-tv-focusable")) el.setAttribute("data-tv-focusable", "");
            }
            if (scope && !scope.hasAttribute("data-tv-mode")) scope.setAttribute("data-tv-mode", "");
            if (pending && !scope) {
                const content = items.filter((el) => !el.closest(".tv-nav-bar"));
                if (content.length) {
                    const keys = content.map((el) => ({ key: keyFor(el) }));
                    if (!saved || keys.some((item) => item.key === saved.key) || Date.now() >= restoreDeadline) {
                        focusElement(content[restoreFocusIndex(keys, saved)]);
                        pending = false;
                    }
                }
            }
        };
        const observer = new MutationObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(sync);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "hidden", "aria-hidden", "disabled"] });
        const containFocus = (event: FocusEvent) => {
            const scope = getScope();
            if (scope && scope !== previousScope && !openers.has(scope)) openers.set(scope, lastActive);
            if (scope && !scope.contains(event.target as Node)) focusElement(getAllFocusable()[0] ?? null);
            remember(event);
            lastActive = event.target as HTMLElement;
        };
        const trapTab = (event: KeyboardEvent) => {
            if (event.key !== "Tab" || !getScope()) return;
            const items = getAllFocusable();
            if (!items.length) return;
            event.preventDefault();
            const index = items.indexOf(document.activeElement as HTMLElement);
            focusElement(items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]);
        };
        document.addEventListener("focusin", containFocus);
        document.addEventListener("keydown", trapTab, true);
        frame = requestAnimationFrame(sync);
        const fallback = setTimeout(sync, 2100);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            clearTimeout(fallback);
            document.removeEventListener("focusin", containFocus);
            document.removeEventListener("keydown", trapTab, true);
            for (const layer of openers.keys()) layer.removeAttribute("data-tv-mode");
        };
    }, [tvMode, pathname, getAllFocusable, getScope, focusElement]);

    return {
        handleNavigation,
        cursor: { x: cursorX, y: cursorY, visible: cursorVisible, hovering: cursorHovering, targetRect: cursorTargetRect },
    };
}
