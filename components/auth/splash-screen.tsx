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
                className="invert dark:invert-0 animate-pulse"
                loading="eager"
            />
            <span className="text-xs tracking-widest uppercase text-muted-foreground">
                {stage || "Loading"}
            </span>
        </div>
    );
});
