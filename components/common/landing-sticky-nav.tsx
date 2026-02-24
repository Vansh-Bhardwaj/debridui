"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LandingStickyNav() {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.6);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <header
            className={`fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-background/80 border-b border-border/50 transition-all duration-300 ${
                visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
            }`}>
            <div className="max-w-6xl mx-auto px-6 md:px-12 lg:px-20 h-14 flex items-center justify-between">
                <Image
                    className="dark:invert h-4 w-auto"
                    src="/logo.svg"
                    alt="DebridUI"
                    width={80}
                    height={26}
                />
                <Button asChild size="sm">
                    <Link href="/dashboard">
                        Open App
                        <ArrowRightIcon className="size-3.5 ml-1.5" />
                    </Link>
                </Button>
            </div>
        </header>
    );
}
