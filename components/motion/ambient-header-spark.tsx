import { memo } from "react";
import { cn } from "@/lib/utils";

/** Subtle orbiting dot — adds a little life to the shell without blur/glass. */
export const AmbientHeaderSpark = memo(function AmbientHeaderSpark({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                "hidden sm:inline-flex shrink-0 items-center justify-center size-5 text-primary/40 pointer-events-none motion-reduce:hidden",
                className
            )}
            aria-hidden
        >
            <svg viewBox="0 0 32 32" className="size-4 overflow-visible" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="16" cy="6" r="1.75" fill="currentColor">
                    <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 16 16"
                        to="360 16 16"
                        dur="14s"
                        repeatCount="indefinite"
                    />
                </circle>
            </svg>
        </span>
    );
});
