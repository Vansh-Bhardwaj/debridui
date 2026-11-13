"use client";
export const dynamic = "force-static";

import { SearchContent } from "@/components/mdb/search-content";
import { useSettingsStore } from "@/lib/stores/settings";
import { useState } from "react";
import { useDevice } from "@/components/device/device-provider";

let lastTVQuery = "";

export default function SearchPage() {
    const savedTVMode = useSettingsStore((s) => s.settings.tvMode);
    const { isTV } = useDevice();
    const tvMode = isTV || savedTVMode;
    const [initialQuery] = useState(() => tvMode ? lastTVQuery : "");

    return (
        <div data-tv-section="search" onClickCapture={(event) => {
            if (tvMode) lastTVQuery = event.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.value ?? "";
        }} onInputCapture={(event) => {
            if (tvMode && event.target instanceof HTMLInputElement && event.target.type === "search") lastTVQuery = event.target.value;
        }} className={tvMode ? "mx-auto w-full max-w-6xl pb-16" : "mx-auto w-full max-w-4xl pb-16"}>
            {/* Editorial header */}
            <div className="pt-8 pb-10 space-y-2 text-center" data-tv-section>
                <span className="text-xs tracking-widest uppercase text-muted-foreground">Discover</span>
                <h1 className="text-3xl sm:text-4xl font-light">Search</h1>
                <p className="text-sm text-muted-foreground">Movies, TV shows, and your files</p>
            </div>

            <SearchContent variant="page" defaultQuery={initialQuery} autoFocus />
        </div>
    );
}
