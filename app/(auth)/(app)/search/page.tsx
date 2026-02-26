"use client";
export const dynamic = "force-static";

import { SearchContent } from "@/components/mdb/search-content";
import { useSettingsStore } from "@/lib/stores/settings";

export default function SearchPage() {
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    return (
        <div className={tvMode ? "mx-auto w-full max-w-6xl pb-16" : "mx-auto w-full max-w-4xl pb-16"}>
            {/* Editorial header */}
            <div className="pt-8 pb-10 space-y-2 text-center" data-tv-section>
                <span className="text-xs tracking-widest uppercase text-muted-foreground">Discover</span>
                <h1 className="text-3xl sm:text-4xl font-light">Search</h1>
                <p className="text-sm text-muted-foreground">Movies, TV shows, and your files</p>
            </div>

            <SearchContent variant="page" autoFocus />
        </div>
    );
}
