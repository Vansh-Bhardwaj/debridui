import Image from "next/image";
import { memo } from "react";

interface SplashScreenProps {
    stage?: string;
}

// `rerender-memo` - Static component, safe to memoize
export const SplashScreen = memo(function SplashScreen({ stage }: SplashScreenProps) {
    return (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background">
            <Image
                src="/icon.svg"
                alt="DebridUI"
                width={64}
                height={64}
                className="invert dark:invert-0 animate-[splash-logo_0.6s_cubic-bezier(0.16,1,0.3,1)_both]"
                loading="eager"
            />
            <span className="text-xs tracking-widest uppercase text-muted-foreground animate-[splash-text_0.4s_0.3s_ease_both]">
                {stage || "Loading"}
            </span>
            {/* Indeterminate progress bar */}
            <div className="w-32 h-[2px] rounded-full bg-muted overflow-hidden animate-[splash-text_0.4s_0.5s_ease_both]">
                <div className="h-full bg-primary rounded-full animate-[splash-bar_1.8s_cubic-bezier(0.4,0,0.2,1)_infinite]" />
            </div>
        </div>
    );
});
