import { memo } from "react";
import { cn } from "@/lib/utils";

/** YouTube mark (Simple Icons) for trailer actions — matches other external brand icons in the app. */
export const YoutubeTrailerIcon = memo(function YoutubeTrailerIcon({ className }: { className?: string }) {
    return (
        <img
            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/youtube.svg"
            alt=""
            className={cn("size-5 shrink-0 opacity-90 dark:invert", className)}
            loading="lazy"
            decoding="async"
        />
    );
});
