"use client";

import { useSyncExternalStore } from "react";
import { Check, Cpu, X } from "reicon-react";
import { Switch } from "@/components/ui/switch";
import { playbackEngine, usePlaybackOverride } from "@/lib/playback/preferences";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getCodecSupport, type CodecSupport, type PlaybackMode } from "@/lib/utils/codec-support";
import { getDeviceProfile, type DeviceProfile } from "@/lib/playback/device-profile";
import type { StreamingSettings } from "@/lib/stores/settings";

const noopSubscribe = () => () => {};

function routeSummary(p: DeviceProfile): string {
    if (p.route === "native")
        return "Apple’s player supports MP4 originals and provider HLS. MKV requires transcoding in fallback mode.";
    const hls = p.hls === "native" ? "Safari's built-in HLS" : "hls.js";
    return p.mkv
        ? `Original file when this browser can decode it, otherwise the converted stream (${hls}).`
        : `MP4 originals play directly; MKV and unsupported codecs use the converted stream (${hls}).`;
}

const ENGINES: { id: PlaybackMode; name: string; description: string }[] = [
    { id: "native", name: "Native only", description: "Always the original file; choose transcode manually if it fails." },
    { id: "fallback", name: "Native, fall back to transcode", description: "Play the original when supported; transcode when needed." },
    { id: "transcode", name: "Transcode only", description: "Always provider HLS; offer native if unavailable for this file or plan." },
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
    const device = useSyncExternalStore(noopSubscribe, getDeviceProfile, () => null);

    const override = usePlaybackOverride((s) => s.mode);
    const setOverride = usePlaybackOverride((s) => s.setMode);
    const mode = override ?? streaming.playbackEngine;
    const effectiveEngine = playbackEngine(streaming, override);

    return (
        <div data-tv-section="browser-playback" className="space-y-4 pt-2">
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <Cpu className="size-4 text-muted-foreground" />
                    <Label className="text-sm">Playback mode</Label>
                </div>
                <Label className="flex min-h-phone-touch items-center gap-3 text-sm">
                    <Switch data-tv-focusable checked={override !== null} onCheckedChange={(checked) => setOverride(checked ? streaming.playbackEngine : null)} />
                    Override on this device
                </Label>
                <p className="text-xs text-muted-foreground">{override ? "Changes apply only to this device." : "Changes follow this profile across devices."}</p>
                <div role="group" aria-label="Playback mode" className="grid gap-0 sm:grid-cols-3">
                    {ENGINES.map((engine) => (
                        <button
                            key={engine.id}
                            aria-pressed={mode === engine.id}
                            onClick={() => override !== null ? setOverride(engine.id) : updateStreaming({ playbackEngine: engine.id })}
                            data-tv-focusable
                            className={cn(
                                "min-h-phone-touch focus-visible:outline focus-visible:outline-primary rounded-sm border px-3 py-2.5 text-left transition-colors duration-300",
                                mode === engine.id
                                    ? "border-primary bg-primary/5 text-foreground"
                                    : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                            )}>
                            <span className="block text-sm font-medium">{engine.name}</span>
                            <span className="mt-0.5 block text-xs leading-snug opacity-70">{engine.description}</span>
                        </button>
                    ))}
                </div>

                {mode === "fallback" && (
                    <details className="border border-border/50 p-3">
                        <summary data-tv-focusable className="min-h-phone-touch cursor-pointer text-sm">Advanced fallback</summary>
                        <Label className="flex min-h-phone-touch items-center gap-3 text-sm">
                            <Switch data-tv-focusable checked={!!streaming.deviceAudioRemux} onCheckedChange={(checked) => updateStreaming({ deviceAudioRemux: checked })} />
                            Convert Dolby audio on this device first
                        </Label>
                        <p className="text-xs text-muted-foreground">Keeps original video and uses this device’s CPU where supported; otherwise uses provider HLS.</p>
                    </details>
                )}
                {device && (
                    <div className="rounded-sm border border-border/50 bg-muted/10 p-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-xs tracking-widest uppercase text-muted-foreground">This device</span>
                            <span className="text-sm">{device.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{routeSummary(device)} {effectiveEngine === "native" ? "Native only is active." : effectiveEngine === "transcode" ? "Transcode only is active." : "Native fallback is active."}</p>
                    </div>
                )}

                {support && (
                    <div className="rounded-sm border border-border/50 bg-muted/10 p-3 space-y-2">
                        <span className="text-xs tracking-widest uppercase text-muted-foreground">
                            This browser decodes
                        </span>
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
                            In fallback mode, unsupported codecs can use your provider’s transcode (when your plan supports it),
                            on-device conversion (Dolby Digital / Digital+ audio), or an external player.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
