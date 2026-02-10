"use client";

import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Keyboard } from "lucide-react";

interface Shortcut {
    keys: string[];
    description: string;
}

interface ShortcutGroup {
    label: string;
    shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
    {
        label: "Global",
        shortcuts: [
            { keys: ["⌘", "K"], description: "Open search" },
            { keys: ["⌘", "B"], description: "Toggle sidebar" },
            { keys: ["?"], description: "Keyboard shortcuts" },
        ],
    },
    {
        label: "Video Player",
        shortcuts: [
            { keys: ["Space"], description: "Play / Pause" },
            { keys: ["←", "→"], description: "Seek ±5s" },
            { keys: ["J", "L"], description: "Seek ±10s" },
            { keys: ["↑", "↓"], description: "Volume ±10%" },
            { keys: ["M"], description: "Toggle mute" },
            { keys: ["F"], description: "Toggle fullscreen" },
            { keys: ["C"], description: "Cycle subtitles" },
            { keys: ["<", ">"], description: "Frame step (paused)" },
        ],
    },
    {
        label: "Preview / Gallery",
        shortcuts: [
            { keys: ["←"], description: "Previous item" },
            { keys: ["→"], description: "Next item" },
            { keys: ["Esc"], description: "Close" },
        ],
    },
];

function Kbd({ children }: { children: string }) {
    return (
        <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded border border-border bg-muted text-[11px] font-mono text-muted-foreground">
            {children}
        </kbd>
    );
}

export function KeyboardShortcutsDialog() {
    const [open, setOpen] = useState(false);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        // Don't trigger when typing in inputs
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

        if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            setOpen(true);
        }
    }, []);

    useEffect(() => {
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Keyboard className="size-4" />
                        Keyboard Shortcuts
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-5 pt-1">
                    {SHORTCUT_GROUPS.map((group) => (
                        <div key={group.label} className="space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="h-px w-6 bg-border" />
                                <span className="text-[10px] tracking-widest uppercase text-muted-foreground">
                                    {group.label}
                                </span>
                            </div>
                            <div className="space-y-1.5">
                                {group.shortcuts.map((shortcut) => (
                                    <div
                                        key={shortcut.description}
                                        className="flex items-center justify-between gap-4 px-1">
                                        <span className="text-sm text-muted-foreground">
                                            {shortcut.description}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {shortcut.keys.map((key, i) => (
                                                <Kbd key={i}>{key}</Kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
                    Press <Kbd>?</Kbd> to toggle this dialog
                </p>
            </DialogContent>
        </Dialog>
    );
}
