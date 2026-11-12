"use client";

import { useSyncExternalStore } from "react";
import { Ban, Check, Cpu, History, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCodecSupport, type CodecSupport, type PlaybackEngine } from "@/lib/utils/codec-support";
import { clearFailedSources } from "@/lib/streaming/source-health";
import type { StreamingSettings } from "@/lib/stores/settings";

const noopSubscribe = () => () => {};

const ENGINES: { id: PlaybackEngine; name: string; description: string }[] = [
    { id: "auto", name: "Auto", description: "Original file when your browser can decode it, otherwise a compatible stream" },
    { id: "original", name: "Original file", description: "Always the untouched file — best quality, may be silent or fail in Chrome" },
    { id: "compatible", name: "Compatible stream", description: "Always the provider's transcoded stream — plays everywhere" },
    { id: "device", name: "On this device", description: "Original video; Dolby audio converted in your browser. Uses your CPU, no server" },
];

const CODECS: { key: keyof CodecSupport; label: string }[] = [
    { key: "h264", label: "H.264" },
    { key: "hevc", label: "HEVC" },
    { key: "av1", label: "AV1" },
    { key: "aac", label: "AAC" },
    { key: "ac3", label: "Dolby Digital" },
    { key: "eac3", label: "Dolby Digital+" },
    { key: "dts", label: "DTS" },
    { key: "truehd", label: "TrueHD" },
    { key: "hdr", label: "HDR" },
];

function ToggleRow({
    id,
    icon: Icon,
    label,
    description,
    checked,
    onChange,
    children,
}: {
    id: string;
    icon: typeof Lock;
    label: string;
    description: string;
    checked: boolean;
    onChange: (value: boolean) => void;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 p-3">
            <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground shrink-0" />
                    <Label htmlFor={id} className="text-sm">
                        {label}
                    </Label>
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
                {children}
            </div>
            <Switch id={id} className="shrink-0" checked={checked} onCheckedChange={onChange} data-tv-focusable="list" />
        </div>
    );
}

/** Browser playback compatibility: engine choice, codec readout, source hygiene. */
export function PlaybackCompatibility({
    streaming,
    updateStreaming,
}: {
    streaming: StreamingSettings;
    updateStreaming: (updates: Partial<StreamingSettings>) => void;
}) {
    // Codec probing needs the DOM: null on the server, cached result on the client.
    const support = useSyncExternalStore(noopSubscribe, getCodecSupport, () => null);

    return (
        <div className="space-y-4 pt-2">
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-muted-foreground" />
                    <Label className="text-sm">Browser Playback</Label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {ENGINES.map((engine) => (
                        <button
                            key={engine.id}
                            onClick={() => updateStreaming({ playbackEngine: engine.id })}
                            data-tv-focusable
                            className={cn(
                                "rounded-sm border px-3 py-2.5 text-left transition-colors duration-300",
                                streaming.playbackEngine === engine.id
                                    ? "border-primary bg-primary/5 text-foreground"
                                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                            )}>
                            <span className="block text-sm font-medium">{engine.name}</span>
                            <span className="mt-0.5 block text-xs leading-snug opacity-70">{engine.description}</span>
                        </button>
                    ))}
                </div>

                {support && (
                    <div className="rounded-sm border border-border/50 bg-muted/10 p-3 space-y-2">
                        <span className="text-xs tracking-widest uppercase text-muted-foreground">This browser decodes</span>
                        <div className="flex flex-wrap gap-1.5">
                            {CODECS.map(({ key, label }) => (
                                <span
                                    key={key}
                                    className={cn(
                                        "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs",
                                        support[key]
                                            ? "border-border/50 text-foreground"
                                            : "border-dashed border-border/40 text-muted-foreground/70"
                                    )}>
                                    {support[key] ? <Check className="size-3" /> : <X className="size-3" />}
                                    {label}
                                </span>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Crossed-out codecs play through the provider&apos;s compatible stream (TorBox Pro), on-device
                            conversion (Dolby Digital / Digital+ audio), or an external player.
                        </p>
                    </div>
                )}
            </div>

            <ToggleRow
                id="lock-source"
                icon={Lock}
                label="Keep Source Once Playing"
                description="If a stream drops mid-playback, reconnect to the same file instead of switching releases"
                checked={streaming.lockSourceAfterStart}
                onChange={(checked) => updateStreaming({ lockSourceAfterStart: checked })}
            />
            <ToggleRow
                id="skip-cam"
                icon={Ban}
                label="Skip Cam Releases"
                description="Rank CAM, telesync and screener rips last"
                checked={streaming.skipCamReleases}
                onChange={(checked) => updateStreaming({ skipCamReleases: checked })}
            />
            <ToggleRow
                id="remember-failed"
                icon={History}
                label="Remember Failed Sources"
                description="Sources that failed or were placeholder files rank last on this device for 7 days"
                checked={streaming.rememberFailedSources}
                onChange={(checked) => updateStreaming({ rememberFailedSources: checked })}>
                <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                        clearFailedSources();
                        toast.success("Failed-source memory cleared");
                    }}>
                    Clear memory
                </Button>
            </ToggleRow>
        </div>
    );
}
