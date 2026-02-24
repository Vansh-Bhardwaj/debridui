"use client";

import { CommandDialog } from "@/components/ui/command";
import { SearchContent } from "./search-content";
import { useSettingsStore } from "@/lib/stores/settings";

interface SearchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);
    const handleClose = () => {
        onOpenChange(false);
    };

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            shouldFilter={false}
            className={tvMode
                ? "w-11/12 sm:w-5/6 sm:max-w-none md:max-w-3xl lg:max-w-5xl xl:max-w-6xl p-0"
                : "w-11/12 sm:w-5/6 sm:max-w-none md:max-w-2xl lg:max-w-4xl p-0"
            }>
            <SearchContent variant="modal" onClose={handleClose} autoFocus />
        </CommandDialog>
    );
}
