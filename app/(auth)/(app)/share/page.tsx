"use client";
export const dynamic = "force-static";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@bprogress/next/app";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { queryClient } from "@/lib/query-client";
import { toast } from "sonner";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/async-state";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";

/**
 * Web Share Target handler.
 *
 * Invoked by the OS share-sheet (Android, iOS A2HS, desktop PWAs) via the
 * `share_target` entry in manifest.json. Parses the shared URL/text/title
 * query params, extracts the first http(s) or magnet: URL, and queues it on
 * the current debrid account. Redirects to /files on success.
 */
function extractFirstUrl(text: string | null): string | null {
    if (!text) return null;
    const m = text.match(/\b(magnet:\?[^\s]+|https?:\/\/[^\s]+)/i);
    return m?.[0] ?? null;
}

function SharePageInner() {
    const params = useSearchParams();
    const router = useRouter();
    const { client, currentAccount } = useAuthGuaranteed();

    const sharedUrl = params.get("url");
    const sharedText = params.get("text");
    const sharedTitle = params.get("title");
    const candidate = extractFirstUrl(sharedUrl) ?? extractFirstUrl(sharedText) ?? extractFirstUrl(sharedTitle);

    // Initial state derived from query params — avoids setState-in-effect violations.
    const [status, setStatus] = useState<"idle" | "adding" | "done" | "error">(() =>
        candidate ? "adding" : "error"
    );
    const [errorMsg, setErrorMsg] = useState<string | null>(() =>
        candidate ? null : "No valid URL or magnet link was shared."
    );
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current || !candidate) return;
        handledRef.current = true;
        const toastId = toast.loading("Adding shared link to your debrid account");
        client
            .addTorrent([candidate])
            .then((results) => {
                const values = Object.values(results);
                const anySuccess = values.some((r) => r.success);
                if (anySuccess) {
                    toast.success("Shared link added", { id: toastId });
                    queryClient.invalidateQueries({ queryKey: [currentAccount.id, "getTorrentList"] });
                    setStatus("done");
                    router.replace("/files");
                } else {
                    const firstErr = values.find((r) => !r.success)?.message ?? "Failed to add";
                    toast.error(firstErr, { id: toastId });
                    setStatus("error");
                    setErrorMsg(firstErr);
                }
            })
            .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : "Failed to add link";
                toast.error(msg, { id: toastId });
                setStatus("error");
                setErrorMsg(msg);
            });
    }, [candidate, client, currentAccount.id, router]);

    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 pb-16">
            <PageHeader
                icon={Share2}
                title="Adding shared link"
                description="DebridUI is queuing the link you shared."
            />
            {status === "adding" && <LoadingState label="Contacting debrid…" />}
            {status === "done" && (
                <EmptyState
                    title="Added"
                    description="Redirecting you to Files…"
                />
            )}
            {status === "error" && (
                <>
                    <ErrorState title="Couldn't add shared link" description={errorMsg ?? undefined} />
                    <div className="flex justify-center">
                        <Button variant="outline" onClick={() => router.replace("/files")}>Go to Files</Button>
                    </div>
                </>
            )}
        </div>
    );
}

export default function SharePage() {
    return (
        <Suspense fallback={<LoadingState label="Loading…" />}>
            <SharePageInner />
        </Suspense>
    );
}
