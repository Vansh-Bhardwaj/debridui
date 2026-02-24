"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/stores/settings";

/**
 * TV mode state + branded curtain transition.
 *
 * On toggle: a full black overlay instantly covers the page, branded text
 * animates in, the layout swaps behind the curtain (invisible to user),
 * then the curtain lifts to reveal the new layout. Zero flicker because
 * the black screen is an intentional design element.
 */
export function useTVMode() {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const set = useSettingsStore((s) => s.set);
    const prevRef = useRef(tvMode);
    const animatingRef = useRef(false);

    useEffect(() => {
        const root = document.getElementById("tv-mode-root");
        if (!root) return;

        const changed = prevRef.current !== tvMode;
        prevRef.current = tvMode;

        if (!changed) {
            if (tvMode) {
                root.setAttribute("data-tv-mode", "");
                document.documentElement.requestFullscreen?.().catch(() => {});
            }
            return;
        }

        if (animatingRef.current) return;
        animatingRef.current = true;

        const entering = tvMode;

        // Create the curtain overlay — starts INSTANTLY opaque (no fade-in)
        const curtain = document.createElement("div");
        curtain.className = "tv-curtain tv-curtain-visible";
        curtain.setAttribute("data-direction", entering ? "enter" : "exit");

        // Brand text inside curtain
        const text = document.createElement("div");
        text.className = "tv-curtain-text";
        text.textContent = entering ? "TV MODE" : "DESKTOP";

        // Accent line
        const line = document.createElement("div");
        line.className = "tv-curtain-line";

        curtain.appendChild(text);
        curtain.appendChild(line);
        document.body.appendChild(curtain);

        // Curtain is already opaque — swap layout + fullscreen behind it
        // Use rAF to ensure the curtain has painted before doing anything
        requestAnimationFrame(() => {
            if (entering) {
                // Enter fullscreen FIRST behind the curtain, then swap layout
                // after the viewport has settled
                document.documentElement
                    .requestFullscreen?.()
                    .then(() => {
                        // Wait for viewport resize to finish settling
                        setTimeout(() => {
                            root.setAttribute("data-tv-mode", "");
                            // Another rAF to let the new layout paint
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => doReveal());
                            });
                        }, 200);
                    })
                    .catch(() => {
                        root.setAttribute("data-tv-mode", "");
                        doReveal();
                    });
            } else {
                root.removeAttribute("data-tv-mode");
                if (document.fullscreenElement) {
                    document.exitFullscreen?.()
                        .then(() => setTimeout(doReveal, 200))
                        .catch(() => doReveal());
                } else {
                    doReveal();
                }
            }

            function doReveal() {
                // Wait for text animation to play, then lift curtain
                setTimeout(() => {
                    curtain.classList.add("tv-curtain-exit");

                    curtain.addEventListener("animationend", () => {
                        // Small delay after animation to prevent flash from element removal
                        setTimeout(() => {
                            curtain.remove();
                            animatingRef.current = false;
                        }, 50);
                    }, { once: true });

                    // Fallback removal
                    setTimeout(() => {
                        if (curtain.parentNode) {
                            curtain.remove();
                            animatingRef.current = false;
                        }
                    }, 1200);
                }, 500); // text visible for 500ms
            }
        });

        return () => {
            animatingRef.current = false;
        };
    }, [tvMode]);

    // Exit TV mode on fullscreen exit (Esc key)
    useEffect(() => {
        if (!tvMode) return;
        const handler = () => {
            if (!document.fullscreenElement && !animatingRef.current) {
                set("tvMode", false);
            }
        };
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, [tvMode, set]);

    const toggle = useCallback(() => {
        set("tvMode", !tvMode);
    }, [tvMode, set]);

    return { tvMode, toggle };
}
