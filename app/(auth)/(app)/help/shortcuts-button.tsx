"use client";

import { Button } from "@/components/ui/button";
import { useKeyboardShortcuts } from "@/components/common/keyboard-shortcuts-dialog";
import { Keyboard } from "lucide-react";

export function ShortcutsHelpButton() {
    const { open } = useKeyboardShortcuts();
    return (
        <Button variant="outline" className="gap-2" onClick={open}>
            <Keyboard className="size-4" />
            View Shortcuts
        </Button>
    );
}
