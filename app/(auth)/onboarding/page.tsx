"use client";

import { AddAccountForm } from "@/components/accounts/add-account-form";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Check, ArrowRight, ExternalLink, SkipForward } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import { useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSettingsStore } from "@/lib/stores/settings";
import { useSaveUserSettings } from "@/hooks/use-user-settings";
import { useUserAccounts } from "@/hooks/use-user-accounts";

const STEPS = [
    { label: "Connect", desc: "Debrid service" },
    { label: "Trakt", desc: "Optional" },
    { label: "TMDB", desc: "Optional" },
    { label: "Ready", desc: "All set" },
] as const;

export default function OnboardingPage() {
    const { logout, isLoggingOut } = useAuth();
    const [step, setStep] = useState(0);
    const { data: accounts } = useUserAccounts();
    const hasAccount = (accounts?.length ?? 0) > 0;

    return (
        <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
            {/* Logout button — top right */}
            <div className="fixed top-4 right-4 z-10">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    disabled={isLoggingOut}
                    className="text-muted-foreground hover:text-foreground"
                >
                    <LogOut className="size-4 mr-1.5" />
                    {isLoggingOut ? "Logging out..." : "Logout"}
                </Button>
            </div>

            <div className="w-full max-w-sm">
                {/* Logo */}
                <div className="flex flex-col items-center gap-2 mb-8">
                    <Link href="/" className="flex flex-col items-center gap-2 font-medium">
                        <div className="flex size-12 items-center justify-center">
                            <Image
                                src="/icon.svg"
                                alt="DebridUI"
                                width={48}
                                height={48}
                                className="invert dark:invert-0"
                            />
                        </div>
                        <span className="sr-only">DebridUI</span>
                    </Link>
                </div>

                {/* Step indicator */}
                <div className="flex items-center justify-center gap-1 mb-8">
                    {STEPS.map((s, i) => (
                        <div key={s.label} className="flex items-center gap-1">
                            <button
                                onClick={() => {
                                    // Only allow going back or to completed steps
                                    if (i < step || (i === 0 && hasAccount)) setStep(i);
                                }}
                                className={cn(
                                    "flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs transition-colors",
                                    i === step
                                        ? "text-foreground font-medium"
                                        : i < step
                                          ? "text-primary cursor-pointer hover:text-primary/80"
                                          : "text-muted-foreground/50"
                                )}
                            >
                                <span
                                    className={cn(
                                        "flex size-5 items-center justify-center rounded-full text-[10px] font-medium transition-colors",
                                        i === step
                                            ? "bg-primary text-primary-foreground"
                                            : i < step
                                              ? "bg-primary/20 text-primary"
                                              : "bg-muted text-muted-foreground/50"
                                    )}
                                >
                                    {i < step ? <Check className="size-3" /> : i + 1}
                                </span>
                                <span className="hidden sm:inline">{s.label}</span>
                            </button>
                            {i < STEPS.length - 1 && (
                                <div
                                    className={cn(
                                        "w-6 h-px transition-colors",
                                        i < step ? "bg-primary/40" : "bg-border/50"
                                    )}
                                />
                            )}
                        </div>
                    ))}
                </div>

                {/* Step content */}
                {step === 0 && (
                    <StepConnect
                        hasAccount={hasAccount}
                        onNext={() => setStep(1)}
                    />
                )}
                {step === 1 && (
                    <StepTrakt onNext={() => setStep(2)} onSkip={() => setStep(2)} />
                )}
                {step === 2 && (
                    <StepTmdb onNext={() => setStep(3)} onSkip={() => setStep(3)} />
                )}
                {step === 3 && <StepReady />}
            </div>
        </div>
    );
}

function StepConnect({ hasAccount, onNext }: { hasAccount: boolean; onNext: () => void }) {
    return (
        <div className="space-y-6 animate-[splash-text_0.3s_ease_both]">
            <div className="text-center space-y-1">
                <h1 className="text-xl font-light">Connect your debrid service</h1>
                <p className="text-sm text-muted-foreground">
                    Add at least one account to get started
                </p>
            </div>
            <AddAccountForm />
            {hasAccount && (
                <Button onClick={onNext} className="w-full">
                    Continue
                    <ArrowRight className="size-4 ml-2" />
                </Button>
            )}
        </div>
    );
}

function StepTrakt({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
    const handleConnect = useCallback(() => {
        const clientId = process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;
        if (!clientId) {
            toast.error("Trakt client ID not configured");
            return;
        }
        const redirectUri = `${window.location.origin}/api/trakt/callback`;
        const state = crypto.randomUUID();
        document.cookie = `trakt_oauth_state=${state}; path=/; max-age=600; samesite=lax; secure`;
        const url = `https://trakt.tv/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        window.location.href = url;
    }, []);

    const isTraktAvailable = !!process.env.NEXT_PUBLIC_TRAKT_CLIENT_ID;

    return (
        <div className="space-y-6 animate-[splash-text_0.3s_ease_both]">
            <div className="text-center space-y-1">
                <h1 className="text-xl font-light">Connect Trakt</h1>
                <p className="text-sm text-muted-foreground">
                    Scrobble playback, sync your watchlist & calendar
                </p>
            </div>

            <div className="rounded-sm border border-border/50 p-4">
                <div className="flex items-center gap-3 mb-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-[#ED1C24]/10">
                        <Image
                            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/trakt.svg"
                            alt="Trakt"
                            width={20}
                            height={20}
                            unoptimized
                            className="dark:invert size-5"
                        />
                    </div>
                    <div className="space-y-0.5">
                        <Label className="text-sm font-medium">Trakt.tv</Label>
                        <p className="text-xs text-muted-foreground">
                            Track what you watch automatically
                        </p>
                    </div>
                </div>
                {isTraktAvailable ? (
                    <Button onClick={handleConnect} className="w-full">
                        <ExternalLink className="size-3.5 mr-2" />
                        Connect Trakt
                    </Button>
                ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                        Trakt integration is not configured on this instance
                    </p>
                )}
            </div>

            <div className="flex gap-2">
                <Button variant="ghost" onClick={onSkip} className="flex-1">
                    <SkipForward className="size-3.5 mr-1.5" />
                    Skip
                </Button>
                <Button onClick={onNext} className="flex-1">
                    Continue
                    <ArrowRight className="size-4 ml-2" />
                </Button>
            </div>
        </div>
    );
}

function StepTmdb({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
    const { get, set } = useSettingsStore();
    const tmdbApiKey = get("tmdbApiKey");
    const { mutate: saveSettings } = useSaveUserSettings();
    const tmdbSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleChange = (value: string) => {
        set("tmdbApiKey", value);
        if (tmdbSaveTimeout.current) clearTimeout(tmdbSaveTimeout.current);
        tmdbSaveTimeout.current = setTimeout(() => {
            saveSettings({ tmdb_api_key: value || undefined });
        }, 600);
    };

    return (
        <div className="space-y-6 animate-[splash-text_0.3s_ease_both]">
            <div className="text-center space-y-1">
                <h1 className="text-xl font-light">TMDB API Key</h1>
                <p className="text-sm text-muted-foreground">
                    Used for episode grouping in TV shows
                </p>
            </div>

            <div className="rounded-sm border border-border/50 p-4 space-y-3">
                <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-[#01b4e4]/10">
                        <Image
                            src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/themoviedatabase.svg"
                            alt="TMDB"
                            width={20}
                            height={20}
                            unoptimized
                            className="dark:invert size-5"
                        />
                    </div>
                    <div className="space-y-0.5">
                        <Label htmlFor="tmdb-key" className="text-sm font-medium">TMDB</Label>
                        <p className="text-xs text-muted-foreground">
                            <a
                                href="https://www.themoviedb.org/settings/api"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline hover:text-foreground transition-colors"
                            >
                                Get a free API key →
                            </a>
                        </p>
                    </div>
                </div>
                <Input
                    id="tmdb-key"
                    type="password"
                    placeholder="Enter your TMDB API key"
                    value={tmdbApiKey}
                    onChange={(e) => handleChange(e.target.value)}
                />
            </div>

            <div className="flex gap-2">
                <Button variant="ghost" onClick={onSkip} className="flex-1">
                    <SkipForward className="size-3.5 mr-1.5" />
                    Skip
                </Button>
                <Button onClick={onNext} className="flex-1">
                    Continue
                    <ArrowRight className="size-4 ml-2" />
                </Button>
            </div>
        </div>
    );
}

function StepReady() {
    return (
        <div className="space-y-6 animate-[splash-text_0.3s_ease_both]">
            <div className="text-center space-y-3">
                <div className="flex justify-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
                        <Check className="size-7 text-primary" />
                    </div>
                </div>
                <h1 className="text-xl font-light">You&apos;re all set</h1>
                <p className="text-sm text-muted-foreground">
                    Your account is ready. You can always change these settings later.
                </p>
            </div>
            <Button asChild className="w-full">
                <Link href="/dashboard">
                    Go to Dashboard
                    <ArrowRight className="size-4 ml-2" />
                </Link>
            </Button>
        </div>
    );
}
