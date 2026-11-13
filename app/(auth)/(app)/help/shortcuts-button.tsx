"use client";

import { Button } from "@/components/ui/button";
import { useKeyboardShortcuts } from "@/components/common/keyboard-shortcuts-dialog";
import { Keyboard } from "reicon-react";
import { useDevice } from "@/components/device/device-provider";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useIsTVMode } from "@/hooks/use-tv-mode";

export function ShortcutsHelpButton() {
    const { open } = useKeyboardShortcuts();
    const { isTV } = useDevice();
    const tvMode = useIsTVMode();
    if (isTV || tvMode) return (
        <Dialog>
            <DialogTrigger asChild>
                <Button data-tv-focusable variant="outline">Remote controls</Button>
            </DialogTrigger>
            <DialogContent data-tv-section="remote-help">
                <DialogHeader>
                    <DialogTitle className="text-tv-title">Remote controls</DialogTitle>
                    <DialogDescription>Use your remote or a connected gamepad.</DialogDescription>
                </DialogHeader>
                <dl className="space-y-4 text-tv-base">
                    <div><dt className="text-primary">D-pad</dt><dd>Move between controls and rows.</dd></div>
                    <div><dt className="text-primary">OK / A</dt><dd>Select. Select a text field to open the platform keyboard.</dd></div>
                    <div><dt className="text-primary">Back / B</dt><dd>Close a dialog or return to the previous page.</dd></div>
                    <div><dt className="text-primary">Up</dt><dd>From the first row, move to the top navigation.</dd></div>
                </dl>
                <DialogClose asChild><Button data-tv-focusable variant="outline">Close</Button></DialogClose>
            </DialogContent>
        </Dialog>
    );
    return (
        <Button data-tv-focusable variant="outline" className="gap-2" onClick={open}>
            <Keyboard className="size-4" />
            View Shortcuts
        </Button>
    );
}
