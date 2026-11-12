"use client";

import { ProgressProvider } from "@bprogress/next/app";
import { Toaster } from "@/components/ui/sonner";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ThemeProvider } from "next-themes";
import { queryClient, persistOptions } from "@/lib/query-client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/lib/polyfills";
import { useEffect } from "react";

const STALE_CHUNK = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module/i;

// After a deploy, a cached page shell can reference JS chunks that no longer
// exist. Reload once to pick up the new build instead of showing a broken page.
function useStaleChunkRecovery() {
    useEffect(() => {
        const onError = (reason: unknown) => {
            const msg = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? "");
            if (!STALE_CHUNK.test(msg)) return;
            try {
                if (sessionStorage.getItem("chunk-reload")) return;
                sessionStorage.setItem("chunk-reload", "1");
            } catch { return; }
            window.location.reload();
        };
        const onWindowError = (e: ErrorEvent) => onError(e.error ?? e.message);
        const onRejection = (e: PromiseRejectionEvent) => onError(e.reason);
        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onRejection);
        // A successful load clears the guard so a later deploy can recover again.
        const t = setTimeout(() => { try { sessionStorage.removeItem("chunk-reload"); } catch { } }, 10_000);
        return () => {
            window.removeEventListener("error", onWindowError);
            window.removeEventListener("unhandledrejection", onRejection);
            clearTimeout(t);
        };
    }, []);
}

const Providers = ({ children }: { children: React.ReactNode }) => {
    useStaleChunkRecovery();
    return (
        <ThemeProvider attribute="class" defaultTheme="dark">
            <ProgressProvider height="4px" color="var(--primary)" options={{ showSpinner: false }} shallowRouting>
                <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
                    <TooltipProvider delayDuration={700}>{children}</TooltipProvider>
                </PersistQueryClientProvider>
                <Toaster position="top-right" closeButton richColors />
            </ProgressProvider>
        </ThemeProvider>
    );
};

export default Providers;
