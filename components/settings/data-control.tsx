"use client";

import { useRef, useState } from "react";
import { del } from "idb-keyval";
import { toast } from "sonner";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { queryClient } from "@/lib/query-client";
import { clearFailedSources } from "@/lib/streaming/source-health";
import type { SettingEntry } from "@/lib/settings/registry";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SettingRow } from "./setting-row";

export function DataControl({ entry, kind }: { entry: SettingEntry; kind: string }) {
    const { currentAccount } = useAuthGuaranteed();
    const {
        activeProfile: { id: profileId },
    } = useProfile();
    const [open, setOpen] = useState(false);
    const [clearing, setClearing] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const clearCache = async () => {
        const id = toast.loading("Clearing cache...");
        try {
            if (kind === "links-cache") queryClient.removeQueries({ queryKey: [currentAccount.id, "getDownloadLink"] });
            else {
                await del("DEBRIDUI_CACHE");
                queryClient.clear();
            }
            toast.success("Cache cleared successfully", { id });
        } catch {
            toast.error("Failed to clear cache", { id });
        }
    };
    const clearHistory = async () => {
        setClearing(true);
        try {
            const response = await fetch("/api/history", { method: "DELETE" });
            if (!response.ok) throw new Error("Failed");
            queryClient.setQueriesData<{ history: unknown[]; total: number }>(
                { queryKey: ["watch-history", profileId] },
                (old) => (old ? { history: [], total: 0 } : old)
            );
            queryClient.invalidateQueries({ queryKey: ["continue-watching", profileId] });
            toast.success("Watch history cleared");
            setOpen(false);
        } catch {
            toast.error("Failed to clear watch history");
        } finally {
            setClearing(false);
        }
    };
    const clear = () => {
        if (kind === "links-cache" || kind === "all-cache") {
            void clearCache();
            return;
        }
        if (kind === "watch-history") {
            setOpen(true);
            return;
        }
        if (kind === "failed-sources") {
            clearFailedSources();
            toast.success("Failed-source memory cleared");
            return;
        }
        try {
            localStorage.removeItem("debridui-recent-searches");
            toast.success("Search history cleared");
        } catch {
            toast.error("Failed to clear search history");
        }
    };
    return (
        <>
            <SettingRow entry={entry}>
                <Button
                    id={entry.id}
                    ref={trigger}
                    variant={kind === "all-cache" ? "destructive" : "outline"}
                    data-tv-focusable
                    className="min-h-phone-touch"
                    onClick={clear}>
                    {kind === "links-cache"
                        ? "Clear Links"
                        : kind === "all-cache"
                          ? "Clear All"
                          : kind === "watch-history"
                            ? "Clear History"
                            : kind === "failed-sources"
                              ? "Clear memory"
                              : "Clear Searches"}
                </Button>
            </SettingRow>
            {kind === "watch-history" && (
                <>
                    <p className="text-xs text-muted-foreground">
                        Your watch progress and history are only stored in your account and are never shared.
                    </p>
                    <AlertDialog
                        open={open}
                        onOpenChange={(value) => {
                            if (!clearing) setOpen(value);
                        }}>
                        <AlertDialogContent
                            data-tv-section="clear-watch-history"
                            onCloseAutoFocus={(event) => {
                                event.preventDefault();
                                trigger.current?.focus();
                            }}>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Clear watch history?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will permanently delete all your watch history from the server. This cannot be
                                    undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel data-tv-focusable className="min-h-phone-touch" disabled={clearing}>
                                    Cancel
                                </AlertDialogCancel>
                                <AlertDialogAction
                                    data-tv-focusable
                                    className="min-h-phone-touch"
                                    variant="destructive"
                                    disabled={clearing}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        void clearHistory();
                                    }}>
                                    {clearing ? "Working..." : "Clear History"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </>
            )}
        </>
    );
}
