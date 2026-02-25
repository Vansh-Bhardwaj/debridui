"use client";

import { createPortal } from "react-dom";
import { useSettingsStore } from "@/lib/stores/settings";

interface TargetRect {
    left: number;
    top: number;
    width: number;
    height: number;
    borderRadius: string;
}

interface TVCursorProps {
    x: number;
    y: number;
    visible: boolean;
    hovering?: boolean;
    targetRect?: TargetRect | null;
}

export function TVCursor({ x, y, visible, hovering, targetRect }: TVCursorProps) {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    if (!tvMode || !visible) return null;

    const showBlob = hovering && targetRect;

    // Portal to body guarantees cursor renders above every overlay (video player, dialogs, etc.)
    return createPortal(
        <>
            {/* ── Dot: precise small indicator that follows the stick ── */}
            <div
                className="pointer-events-none fixed"
                style={{
                    left: x,
                    top: y,
                    transform: "translate(-50%, -50%)",
                    willChange: "left, top",
                    zIndex: 2147483646, // max z-index - 1
                    opacity: showBlob ? 0 : 1,
                    transition: "opacity 100ms ease",
                }}
            >
                {/* Outer ring */}
                <div style={{
                    position: "absolute",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.75)",
                    boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5), 0 2px 14px rgba(0,0,0,0.65)",
                    transform: "translate(-50%, -50%)",
                    top: "50%",
                    left: "50%",
                }} />
                {/* Inner dot */}
                <div style={{
                    position: "absolute",
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "white",
                    boxShadow: "0 0 6px rgba(255,255,255,0.9)",
                    transform: "translate(-50%, -50%)",
                    top: "50%",
                    left: "50%",
                }} />
            </div>

            {/* ── Blob: spring-animated outline ring that frames the hovered element ── */}
            {showBlob && (
                <div
                    key={`${targetRect.left}:${targetRect.top}:${targetRect.width}:${targetRect.height}`}
                    className="pointer-events-none fixed tv-cursor-blob"
                    style={{
                        left: targetRect.left,
                        top: targetRect.top,
                        width: targetRect.width,
                        height: targetRect.height,
                        borderRadius: targetRect.borderRadius || "var(--radius)",
                        outline: "2.5px solid hsl(var(--primary))",
                        outlineOffset: "3px",
                        background: "transparent",
                        willChange: "transform",
                        zIndex: 2147483645, // max z-index - 2
                    }}
                />
            )}
        </>,
        document.body
    );
}
