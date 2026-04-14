"use client";

import { useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { easeOutQuint, tweenScrollLeft } from "@/lib/motion/tween-scroll";

const SCROLL_AMOUNT = 320;
const TWEEN_MS = 560;

export function ScrollCarousel({ className, children, ...props }: React.ComponentProps<typeof ScrollArea>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const cancelTweenRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        const container = containerRef.current;
        const viewport = scrollContainerRef.current?.querySelector("[data-radix-scroll-area-viewport]");
        if (!container || !viewport) return;

        const checkScrollable = () => {
            const isScrollable = viewport.scrollWidth > viewport.clientWidth;
            container.dataset.scrollable = String(isScrollable);
        };

        checkScrollable();

        const resizeObserver = new ResizeObserver(checkScrollable);
        resizeObserver.observe(viewport);

        return () => resizeObserver.disconnect();
    }, []);

    const scroll = useCallback((direction: "left" | "right") => {
        const viewport = scrollContainerRef.current?.querySelector("[data-radix-scroll-area-viewport]");
        if (!(viewport instanceof HTMLElement)) return;

        cancelTweenRef.current?.();
        cancelTweenRef.current = null;

        const reduceMotion =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

        const delta = direction === "left" ? -SCROLL_AMOUNT : SCROLL_AMOUNT;
        const target = viewport.scrollLeft + delta;

        if (reduceMotion) {
            viewport.scrollLeft = target;
            return;
        }

        cancelTweenRef.current = tweenScrollLeft(viewport, target, {
            duration: TWEEN_MS,
            easing: easeOutQuint,
        });
    }, []);

    useEffect(() => () => {
        cancelTweenRef.current?.();
        cancelTweenRef.current = null;
    }, []);

    return (
        <div ref={containerRef} className="relative group/scroll">
            <Button
                variant="outline"
                size="icon"
                className="scroll-carousel-btn scroll-carousel-btn-left group/scrl max-md:hidden! absolute -left-4 top-1/2 -translate-y-1/2 z-10 size-8 rounded-sm bg-card border-border/60 opacity-0 shadow-sm group-hover/scroll:opacity-100 transition-[opacity,transform,background-color,border-color,color,box-shadow] duration-300 ease-premium hover:bg-card hover:border-primary/35 hover:text-primary hover:shadow-md active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
                onClick={() => scroll("left")}>
                <ChevronLeft className="size-4 transition-transform duration-300 ease-premium group-hover/scrl:-translate-x-0.5 motion-reduce:transition-none" />
            </Button>
            <Button
                variant="outline"
                size="icon"
                className="scroll-carousel-btn scroll-carousel-btn-right group/scrr max-md:hidden! absolute -right-4 top-1/2 -translate-y-1/2 z-10 size-8 rounded-sm bg-card border-border/60 opacity-0 shadow-sm group-hover/scroll:opacity-100 transition-[opacity,transform,background-color,border-color,color,box-shadow] duration-300 ease-premium hover:bg-card hover:border-primary/35 hover:text-primary hover:shadow-md active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
                onClick={() => scroll("right")}>
                <ChevronRight className="size-4 transition-transform duration-300 ease-premium group-hover/scrr:translate-x-0.5 motion-reduce:transition-none" />
            </Button>
            <ScrollArea ref={scrollContainerRef} className={cn(className)} {...props}>
                {children}
                <ScrollBar orientation="horizontal" className="hidden" />
            </ScrollArea>
        </div>
    );
}
