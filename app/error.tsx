"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "reicon-react";

// A tab opened before a deploy can't load the new build's code; a full reload fixes it.
const STALE_BUILD = /module factory is not available|ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i;

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
    useEffect(() => {
        console.error(error);
        // Reload once per session so a genuine bug can't cause a reload loop.
        if (STALE_BUILD.test(error.message) && !sessionStorage.getItem("dui-stale-reload")) {
            sessionStorage.setItem("dui-stale-reload", "1");
            window.location.reload();
        }
    }, [error]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-10 p-6">
            <div className="flex flex-col items-center gap-6 text-center max-w-md">
                <AlertCircle className="size-10 text-destructive" strokeWidth={1.5} />
                <div className="space-y-3">
                    <h1 className="text-2xl sm:text-3xl font-light">Something went wrong</h1>
                    <p className="text-sm text-muted-foreground">{error.message || "An unexpected error occurred"}</p>
                </div>
                {error.digest && (
                    <p className="text-xs text-muted-foreground">
                        Error ID{" "}
                        <code className="bg-muted/30 px-2 py-0.5 rounded-sm text-foreground">{error.digest}</code>
                    </p>
                )}
            </div>
            <div className="flex gap-3">
                <Button onClick={reset}>Try again</Button>
                <Button variant="outline" asChild>
                    <Link href="/dashboard">Go to Dashboard</Link>
                </Button>
            </div>
        </div>
    );
}
