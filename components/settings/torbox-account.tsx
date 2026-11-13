"use client";

import { useQuery } from "@tanstack/react-query";
import { Refresh } from "reicon-react";
import { useAuthGuaranteed } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";

const count = (value: number | null) => value?.toLocaleString() ?? "Unavailable";
const bytes = (value: number | null) => value === null ? "Unavailable" : `${(value / 1024 ** 3).toFixed(2)} GiB`;
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Unavailable";

export default function TorBoxAccount() {
    const { currentAccount, client } = useAuthGuaranteed();
    const { data, isPending, isFetching, isError, refetch } = useQuery({
        queryKey: [currentAccount.id, "torbox-account"],
        queryFn: () => "getAccountDetails" in client ? client.getAccountDetails() : null,
        enabled: currentAccount.type === "torbox",
        staleTime: 60_000,
    });
    if (currentAccount.type !== "torbox") return null;
    return (
        <div className="space-y-5" data-tv-section="torbox-account">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-xl font-light">{data?.planName ?? "TorBox"}</h3>
                    <p className="text-xs text-muted-foreground">Expires {date(data?.expiry ?? null)}</p>
                </div>
                <Button variant="outline" className="min-h-phone-touch" data-tv-focusable disabled={isFetching} onClick={() => void refetch()}>
                    <Refresh className="size-4" /> Refresh
                </Button>
            </div>
            {isPending && <p role="status" className="text-sm text-muted-foreground">Loading account…</p>}
            {isError && <p role="alert" className="text-sm text-destructive">Account details could not be refreshed. Try again.</p>}
            {data && <>
                <div className="space-y-2">
                    <div className="flex justify-between text-sm"><span>Active slots</span><span>{count(data.activeSlots)} / {count(data.maxSlots)}</span></div>
                    {data.activeSlots !== null && data.maxSlots !== null && <div role="progressbar" aria-label="Active slots" aria-valuenow={data.activeSlots} aria-valuemin={0} aria-valuemax={data.maxSlots} className="h-2 bg-muted/30">
                        <div className="h-full bg-primary" style={{ width: `${Math.min(100, data.activeSlots / Math.max(1, data.maxSlots) * 100)}%` }} />
                    </div>}
                    <p className="text-xs text-muted-foreground">Queued: {count(data.queued)}</p>
                </div>
                <dl className="grid grid-cols-1 gap-4 border-t border-border/50 pt-4 sm:grid-cols-2">
                    {[
                        ["Downloaded", bytes(data.totalDownloaded)], ["Uploaded", bytes(data.totalUploaded)],
                        ["Auto renewal", data.renewal === null ? "Unavailable" : data.renewal ? "Enabled" : "Disabled"],
                        ["Cooldown", data.cooldown_until ? date(data.cooldown_until) : "None"],
                        ["Assigned server", count(data.server)], ["Streaming / transcode", data.transcodeAllowed ? "Available" : "Unavailable on this plan or expiry"],
                        ["Usenet", `${count(data.usage.usenet.active)} active · ${count(data.usage.usenet.queued)} queued · ${count(data.downloads.usenet)} downloaded`],
                        ["Web downloads", `${count(data.usage.webdl.active)} active · ${count(data.usage.webdl.queued)} queued · ${count(data.downloads.webdl)} downloaded`],
                        ["Referral", data.referral ?? "Unavailable"],
                        ["Notifications", `Email: ${data.notifications.email === null ? "unknown" : data.notifications.email ? "on" : "off"} · Web: ${data.notifications.web === null ? "unknown" : data.notifications.web ? "on" : "off"}`],
                    ].map(([label, value]) => <div key={label} className="space-y-1">
                        <dt className="text-xs tracking-widest uppercase text-muted-foreground">{label}</dt>
                        <dd className="break-words text-sm">{value}</dd>
                    </div>)}
                </dl>
            </>}
        </div>
    );
}
