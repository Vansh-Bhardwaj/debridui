"use client";
export const dynamic = "force-static";

import Image from "next/image";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { HelpCircle, ExternalLink, MessageCircle, Bug, Lightbulb, BookOpen, ArrowUpRight, Keyboard } from "lucide-react";
import { DISCORD_URL } from "@/lib/constants";
import { ShortcutsHelpButton } from "./shortcuts-button";

export default function HelpPage() {
    return (
        <div className="mx-auto w-full max-w-4xl space-y-8 pb-16">
            <PageHeader
                icon={HelpCircle}
                title="Help & Support"
                description="Get help and connect with the community"
                divider
            />

            <div className="space-y-8">
                {/* Discord Section */}
                {DISCORD_URL && (
                    <section className="space-y-6">
                        <div className="flex items-center gap-4">
                            <div className="h-px w-8 bg-[#5865F2]" />
                            <span className="text-xs tracking-widest uppercase text-muted-foreground">Community</span>
                        </div>

                        <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-start">
                            <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                    <Image src="https://cdn.simpleicons.org/discord/5865F2" alt="" width={20} height={20} unoptimized className="size-5" />
                                    <h2 className="text-xl font-light">Join our Discord</h2>
                                </div>
                                <p className="text-sm text-muted-foreground max-w-lg">
                                    The fastest way to get help. Connect with the community, report bugs, request
                                    features, and find answers to common questions.
                                </p>

                                <div className="grid sm:grid-cols-2 gap-3 pt-2">
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                        <MessageCircle className="size-4 text-[#5865F2] shrink-0" />
                                        <span>Quick answers from the community</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                        <Bug className="size-4 text-[#5865F2] shrink-0" />
                                        <span>Real-time bug reporting & support</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                        <Lightbulb className="size-4 text-[#5865F2] shrink-0" />
                                        <span>Feature requests & ideas</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                        <BookOpen className="size-4 text-[#5865F2] shrink-0" />
                                        <span>FAQs already answered</span>
                                    </div>
                                </div>
                            </div>

                            <Button className="gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white" asChild>
                                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                                    Join Discord
                                    <ArrowUpRight className="size-4" />
                                </a>
                            </Button>
                        </div>
                    </section>
                )}

                {/* Divider */}
                <div className="h-px bg-border/50" />

                {/* GitHub Section */}
                <section className="space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="h-px w-8 bg-primary" />
                        <span className="text-xs tracking-widest uppercase text-muted-foreground">Open Source</span>
                    </div>

                    <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-start">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Image src="https://cdn.simpleicons.org/github" alt="" width={20} height={20} unoptimized className="size-5 dark:invert" />
                                <h2 className="text-xl font-light">GitHub Repository</h2>
                            </div>
                            <p className="text-sm text-muted-foreground max-w-lg">
                                DebridUI is open source. View the code, track development progress, report issues, and
                                contribute to the project.
                            </p>
                        </div>

                        <div className="flex flex-col sm:flex-row lg:flex-col gap-2">
                            <Button variant="outline" className="gap-2" asChild>
                                <a
                                    href="https://github.com/Vansh-Bhardwaj/debridui"
                                    target="_blank"
                                    rel="noopener noreferrer">
                                    <Image src="https://cdn.simpleicons.org/github" alt="" width={16} height={16} unoptimized className="size-4 dark:invert" />
                                    View Repository
                                    <ExternalLink className="size-4 opacity-50" />
                                </a>
                            </Button>
                            <Button variant="outline" className="gap-2" asChild>
                                <a
                                    href="https://github.com/Vansh-Bhardwaj/debridui/issues"
                                    target="_blank"
                                    rel="noopener noreferrer">
                                    <Bug className="size-4" />
                                    Open Issues
                                    <ExternalLink className="size-4 opacity-50" />
                                </a>
                            </Button>
                        </div>
                    </div>
                </section>

                {/* Divider */}
                <div className="h-px bg-border/50" />

                {/* Keyboard Shortcuts Section */}
                <section className="space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="h-px w-8 bg-primary" />
                        <span className="text-xs tracking-widest uppercase text-muted-foreground">Quick Reference</span>
                    </div>

                    <div className="grid lg:grid-cols-[1fr_auto] gap-8 items-start">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Keyboard className="size-5 text-primary" />
                                <h2 className="text-xl font-light">Keyboard Shortcuts</h2>
                            </div>
                            <p className="text-sm text-muted-foreground max-w-lg">
                                Navigate faster with keyboard shortcuts. Press <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded border border-border/50 bg-muted text-[10px] font-mono text-muted-foreground">?</kbd> anywhere to see the full list.
                            </p>
                        </div>

                        <ShortcutsHelpButton />
                    </div>
                </section>
            </div>
        </div>
    );
}
