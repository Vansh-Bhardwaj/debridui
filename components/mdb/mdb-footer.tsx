import { memo } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface MdbFooterProps {
    className?: string;
}

export const MdbFooter = memo(function MdbFooter({ className }: MdbFooterProps) {
    return (
        <div className={cn("flex items-center justify-center gap-2 text-sm text-muted-foreground", className)}>
            <span>Powered by</span>
            <a
                href="https://trakt.tv"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors">
                <Image src="https://cdn.simpleicons.org/trakt" alt="Trakt" width={20} height={20} unoptimized className="h-5 w-5" />
                <span className="font-medium">Trakt</span>
            </a>
        </div>
    );
});
