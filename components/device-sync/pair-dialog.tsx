"use client";

import { memo, useCallback, useState } from "react";
import { useDeviceSyncStore } from "@/lib/stores/device-sync";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import QRCode from "react-qr-code";

/**
 * Pair Dialog — allows authenticated users to share a pairing link
 * so another device (e.g., a TV) can connect to the same session.
 *
 * Works like YouTube on TV: the primary device shares a link, the TV opens
 * it, and both devices are automatically synced via the Durable Object.
 *
 * The pairing link includes a pre-authenticated token that's valid for 24hr.
 */
export const PairDialog = memo(function PairDialog({
    children,
}: {
    children: React.ReactNode;
}) {
    const enabled = useDeviceSyncStore((s) => s.enabled);
    const [pairUrl, setPairUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [open, setOpen] = useState(false);

    const generatePairLink = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/remote/token");
            if (!res.ok) throw new Error("Failed to generate token");
            const { token } = (await res.json()) as { token: string };
            const url = `${window.location.origin}/pair?token=${encodeURIComponent(token)}`;
            setPairUrl(url);
        } catch {
            toast.error("Failed to generate pairing link");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleOpen = useCallback(
        (isOpen: boolean) => {
            setOpen(isOpen);
            if (isOpen && !pairUrl) {
                generatePairLink();
            }
            if (!isOpen) {
                setCopied(false);
            }
        },
        [pairUrl, generatePairLink]
    );

    const handleCopy = useCallback(async () => {
        if (!pairUrl) return;
        try {
            await navigator.clipboard.writeText(pairUrl);
            setCopied(true);
            toast.success("Link copied");
            setTimeout(() => setCopied(false), 2000);
        } catch {
            toast.error("Failed to copy");
        }
    }, [pairUrl]);

    const handleShare = useCallback(async () => {
        if (!pairUrl || !navigator.share) return;
        try {
            await navigator.share({
                title: "DebridUI — Connect Device",
                text: "Open this link on your TV or other device to connect it to your session.",
                url: pairUrl,
            });
        } catch (e) {
            // User cancelled share — not an error
            if ((e as Error).name !== "AbortError") {
                toast.error("Failed to share");
            }
        }
    }, [pairUrl]);

    if (!enabled) return null;

    return (
        <Dialog open={open} onOpenChange={handleOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Connect a Device</DialogTitle>
                    <DialogDescription>
                        Open this link on your TV, tablet or other device to connect it to your session.
                        All connected devices can control playback on each other.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                    {loading ? (
                        <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                            Generating link...
                        </div>
                    ) : pairUrl ? (
                        <>
                            {/* QR Code */}
                            <div className="flex justify-center py-2">
                                <div className="rounded-sm border border-border/50 p-3 bg-white">
                                    <QRCode value={pairUrl} size={160} level="M" />
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                                Scan with your phone or tablet camera
                            </p>

                            {/* Pairing URL display */}
                            <div className="flex items-center gap-2 rounded-sm border border-border/50 bg-muted/30 p-3">
                                <Link2 className="size-4 text-muted-foreground shrink-0" />
                                <code className="flex-1 text-xs break-all select-all text-muted-foreground">
                                    {pairUrl}
                                </code>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    onClick={handleCopy}
                                    variant="outline"
                                    size="sm"
                                    className="flex-1"
                                >
                                    {copied ? (
                                        <Check className="size-3.5" />
                                    ) : (
                                        <Copy className="size-3.5" />
                                    )}
                                    {copied ? "Copied" : "Copy link"}
                                </Button>

                                {typeof navigator !== "undefined" && "share" in navigator && (
                                    <Button
                                        onClick={handleShare}
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                    >
                                        <Share2 className="size-3.5" />
                                        Share
                                    </Button>
                                )}
                            </div>

                            <p className="text-xs text-muted-foreground text-center">
                                Link expires in 24 hours · Only works when you&#39;re online
                            </p>
                        </>
                    ) : (
                        <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">
                            Failed to generate link
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
});
