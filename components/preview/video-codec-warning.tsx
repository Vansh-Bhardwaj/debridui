"use client";

import { memo, useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaPlayer } from "@/lib/types";
import { cn } from "@/lib/utils";

interface VideoCodecWarningProps {
    show: boolean;
    isPlaying?: boolean;
    onClose: () => void;
    onOpenInPlayer: (player: MediaPlayer) => void;
}

export const VideoCodecWarning = memo(function VideoCodecWarning({
    show,
    isPlaying,
    onClose,
    onOpenInPlayer,
}: VideoCodecWarningProps) {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (show) {
            setIsVisible(true);
            // Auto-dismiss when video starts playing
            if (isPlaying) {
                setIsVisible(false);
                setTimeout(onClose, 300);
                return;
            }
            // Fallback: auto-dismiss after 8 seconds if not playing
            const timer = setTimeout(() => {
                setIsVisible(false);
                setTimeout(onClose, 300); // Wait for exit animation
            }, 8000);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
        }
    }, [show, isPlaying, onClose]);

    if (!show && !isVisible) return null;

    return (
        <div
            className={cn(
                "absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm sm:max-w-md transition-all duration-300 ease-in-out px-4",
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
            )}
        >
            <div className="bg-yellow-500/10 backdrop-blur-md border border-yellow-500/20 rounded-xl p-4 shadow-2xl flex items-start gap-4">
                <div className="bg-yellow-500/20 p-2 rounded-lg">
                    <Info className="h-5 w-5 text-yellow-500 shrink-0" />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-yellow-500">Audio/Codec compatibility issue</p>
                    <p className="text-xs text-white/80 mt-1 leading-relaxed">
                        This format may not play correctly in your browser. For full support, open in an external player.
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 border-none px-3"
                            onClick={() => onOpenInPlayer(MediaPlayer.VLC)}>
                            VLC
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 border-none px-3"
                            onClick={() => onOpenInPlayer(MediaPlayer.MPV)}>
                            MPV
                        </Button>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-[10px] bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500 border-none px-3"
                            onClick={() => onOpenInPlayer(MediaPlayer.IINA)}>
                            IINA
                        </Button>
                    </div>
                </div>

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 -mt-1 -mr-1 hover:bg-white/5 text-white/40 hover:text-white"
                    onClick={() => {
                        setIsVisible(false);
                        setTimeout(onClose, 300);
                    }}
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
});
