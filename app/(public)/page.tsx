import Image from "next/image";
import Link from "next/link";
import {
    ArrowRightIcon,
    ArrowUpRightIcon,
    ChevronDownIcon,
    Play,
    MonitorPlay,
    Subtitles,
    Gamepad2,
    Filter,
    FolderOpen,
    Users,
    Search,
    Globe,
    Zap,
    Activity,
    Timer,
    Database,
    Clapperboard,
    Tv,
    Youtube,
    Star,
    BookOpen,
    Smartphone,
    type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gallery } from "@/components/common/gallery";
import { DISCORD_URL, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ICONS } from "@/lib/constants";
import { AccountType } from "@/lib/types";

const screenshots = [
    {
        id: "dashboard",
        label: "Dashboard",
        src: {
            default: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-1.jpg",
            mobile: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-mobile-1.jpg",
        },
    },
    {
        id: "explorer",
        label: "Explorer",
        src: {
            default: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-2.jpg",
            mobile: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-mobile-2.jpg",
        },
    },
    {
        id: "media",
        label: "Media",
        src: {
            default: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-3.jpg",
            mobile: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-mobile-3.jpg",
        },
    },
    {
        id: "search",
        label: "Search",
        src: {
            default: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-4.jpg",
            mobile: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-mobile-4.jpg",
        },
    },
    {
        id: "addons",
        label: "Addons",
        src: {
            default: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-5.jpg",
            mobile: "https://res.cloudinary.com/viperadnan/image/upload/v1769483514/debridui-mockup-mobile-5.jpg",
        },
    },
];

const techStack = [
    { name: "Next.js", icon: "nextdotjs" },
    { name: "TypeScript", icon: "typescript" },
    { name: "Tailwind", icon: "tailwindcss" },
    { name: "Cloudflare", icon: "cloudflare" },
    { name: "PostgreSQL", icon: "postgresql" },
];

const features: { category: string; icon: LucideIcon; items: { icon: LucideIcon; label: string }[] }[] = [
    {
        category: "Streaming",
        icon: Play,
        items: [
            { icon: MonitorPlay, label: "Built-in video player" },
            { icon: Timer, label: "Continue watching & resume" },
            { icon: Smartphone, label: "Cross-device playback control" },
            { icon: Subtitles, label: "Subtitle integration" },
            { icon: Gamepad2, label: "VLC, IINA, MPV, Kodi & more" },
            { icon: Filter, label: "Smart addon filtering" },
        ],
    },
    {
        category: "Discovery",
        icon: Search,
        items: [
            { icon: Tv, label: "Trakt.tv integration" },
            { icon: Clapperboard, label: "Stremio addon search" },
            { icon: Youtube, label: "YouTube trailer previews" },
            { icon: Star, label: "Cast, ratings & details" },
            { icon: BookOpen, label: "Season & episode browser" },
        ],
    },
    {
        category: "Performance",
        icon: Zap,
        items: [
            { icon: Globe, label: "Cloudflare edge deployment" },
            { icon: Database, label: "Hyperdrive connection pooling" },
            { icon: Activity, label: "Adaptive smart polling" },
            { icon: Users, label: "Multi-account support" },
            { icon: FolderOpen, label: "Real-time file explorer" },
        ],
    },
];

const steps = [
    { num: "01", title: "Sign up", desc: "Create an account or sign in with Google" },
    { num: "02", title: "Connect", desc: "Link Real-Debrid, TorBox, or AllDebrid and add addons" },
    { num: "03", title: "Watch", desc: "Browse, stream and pick up where you left off" },
];

export default function Home() {
    return (
        <div className="min-h-screen">
            {/* Hero */}
            <section className="relative min-h-svh flex flex-col justify-center px-6 py-20 md:px-12 lg:px-20">
                <div className="max-w-6xl mx-auto w-full">
                    {/* Top bar */}
                    <div className="flex items-center justify-between mb-16 md:mb-24">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground tracking-wide uppercase">
                            {techStack.map((tech, i) => (
                                <span key={tech.name} className="hidden sm:flex items-center gap-1.5">
                                    {i > 0 && <span className="text-border mr-4">·</span>}
                                    <Image
                                        src={`https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/${tech.icon}.svg`}
                                        alt={`${tech.name} logo`}
                                        width={12}
                                        height={12}
                                        unoptimized
                                        className="size-3 opacity-50 dark:invert"
                                    />
                                    {tech.name}
                                </span>
                            ))}
                            <Badge className="tracking-wider transition-none">Open Source</Badge>
                        </div>
                    </div>

                    {/* Main content */}
                    <div className="space-y-8 md:space-y-12">
                        <Image
                            className="dark:invert w-full max-w-[220px] sm:max-w-[320px] md:max-w-[420px] h-auto"
                            src="/logo.svg"
                            alt="DebridUI"
                            width={420}
                            height={137}
                            priority
                        />

                        <p className="text-muted-foreground text-xl sm:text-2xl md:text-3xl max-w-xl leading-snug font-light">
                            A performance-focused debrid client with built-in playback, cross-device sync, and subtitle support — deployed at the edge.
                        </p>

                        <div className="flex flex-wrap items-center gap-3 pt-4">
                            <Button asChild size="lg" className="h-12 tracking-wide">
                                <Link href="/dashboard">
                                    Open App
                                    <ArrowRightIcon className="size-4 ml-2" />
                                </Link>
                            </Button>
                            <Button asChild variant="ghost" size="lg" className="h-12 tracking-wide">
                                <Link
                                    href="https://github.com/Vansh-Bhardwaj/debridui"
                                    target="_blank"
                                    rel="noopener noreferrer">
                                    <Image
                                        src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/github.svg"
                                        alt="GitHub logo"
                                        width={16}
                                        height={16}
                                        unoptimized
                                        className="size-4 dark:invert mr-2 opacity-70"
                                    />
                                    Source
                                    <ArrowUpRightIcon className="size-3 ml-1 opacity-50" />
                                </Link>
                            </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3 sm:gap-y-2 pt-2 text-xs sm:text-sm text-muted-foreground">
                            <span className="w-full sm:w-auto">Supports</span>
                            {Object.values(AccountType).map((type, i) => (
                                <span key={type} className="inline-flex items-center gap-1 sm:gap-1.5">
                                    {i > 0 && <span className="text-border mr-1 sm:mr-1.5">·</span>}
                                    <Image
                                        src={ACCOUNT_TYPE_ICONS[type]}
                                        alt={ACCOUNT_TYPE_LABELS[type]}
                                        width={16}
                                        height={16}
                                        className="size-3.5 sm:size-4 rounded-sm"
                                        unoptimized
                                    />
                                    <span className="font-medium text-foreground">{ACCOUNT_TYPE_LABELS[type]}</span>
                                </span>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Scroll indicator */}
                <a
                    href="#screenshots"
                    className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer">
                    <span className="text-[10px] tracking-widest uppercase">Screenshots</span>
                    <ChevronDownIcon className="size-4 animate-bounce" style={{ animationDuration: "2s" }} />
                </a>
            </section>

            {/* Preview */}
            <section id="screenshots" className="px-6 pb-20 md:px-12 lg:px-20 scroll-mt-8">
                <div className="max-w-6xl mx-auto">
                    <Gallery items={screenshots} />
                </div>
            </section>

            {/* Highlights strip */}
            <section className="px-6 py-16 md:px-12 md:py-24 lg:px-20">
                <div className="max-w-6xl mx-auto">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12">
                        {[
                            { icon: MonitorPlay, label: "Built-in Player", desc: "Watch directly in your browser with codec detection" },
                            { icon: Smartphone, label: "Device Sync", desc: "Control playback across devices, Spotify Connect-style" },
                            { icon: Subtitles, label: "Subtitles", desc: "Fetched automatically from Stremio addons" },
                            { icon: Globe, label: "Edge Deployed", desc: "Cloudflare Workers for fast global access" },
                        ].map((item) => {
                            const Icon = item.icon;
                            return (
                                <div key={item.label} className="pl-4 border-l border-border/50">
                                    <Icon className="size-5 text-primary mb-3" strokeWidth={1.5} />
                                    <p className="text-sm font-medium mb-1">{item.label}</p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Divider with label */}
            <div className="px-6 md:px-12 lg:px-20">
                <div className="max-w-6xl mx-auto flex items-center gap-4">
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-xs text-muted-foreground tracking-wider uppercase">How it works</span>
                    <div className="flex-1 h-px bg-border/50" />
                </div>
            </div>

            {/* Steps */}
            <section className="px-6 py-20 md:px-12 md:py-32 lg:px-20">
                <div className="max-w-6xl mx-auto">
                    <div className="grid md:grid-cols-3 gap-12 md:gap-8">
                        {steps.map((step) => (
                            <div key={step.num} className="group">
                                <div className="text-xs text-muted-foreground tracking-widest mb-4">{step.num}</div>
                                <h3 className="text-lg font-medium mb-2">{step.title}</h3>
                                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Divider with label */}
            <div className="px-6 md:px-12 lg:px-20">
                <div className="max-w-6xl mx-auto flex items-center gap-4">
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-xs text-muted-foreground tracking-wider uppercase">Features</span>
                    <div className="flex-1 h-px bg-border/50" />
                </div>
            </div>

            {/* Features */}
            <section className="px-6 py-20 md:px-12 md:py-32 lg:px-20">
                <div className="max-w-6xl mx-auto">
                    <div className="grid md:grid-cols-3 gap-12 md:gap-16">
                        {features.map((section) => {
                            const CategoryIcon = section.icon;
                            return (
                                <div key={section.category}>
                                    <div className="flex items-center gap-2.5 mb-6">
                                        <CategoryIcon className="size-4 text-primary" strokeWidth={1.5} />
                                        <h3 className="text-xs tracking-widest uppercase text-muted-foreground">
                                            {section.category}
                                        </h3>
                                    </div>
                                    <ul className="space-y-3.5">
                                        {section.items.map((item) => {
                                            const ItemIcon = item.icon;
                                            return (
                                                <li
                                                    key={item.label}
                                                    className="flex items-center gap-3 text-sm text-foreground/80 leading-relaxed pl-4 border-l border-border/50">
                                                    <ItemIcon className="size-3.5 text-muted-foreground shrink-0" strokeWidth={1.5} />
                                                    {item.label}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Community */}
            <section className="px-6 py-20 md:px-12 md:py-32 lg:px-20 border-t border-border/50">
                <div className="max-w-6xl mx-auto">
                    <div className="max-w-md">
                        <h2 className="text-2xl md:text-3xl font-light mb-4">Join the community</h2>
                        <p className="text-muted-foreground mb-8 leading-relaxed">
                            Get help, share feedback, and stay updated.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            {DISCORD_URL && (
                                <Button asChild className="h-11 px-5 bg-[#5865F2] hover:bg-[#4752C4] text-white">
                                    <Link href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                                        <Image
                                            src="https://cdn.simpleicons.org/discord/white"
                                            alt="Discord logo"
                                            width={16}
                                            height={16}
                                            unoptimized
                                            className="size-4 mr-2"
                                        />
                                        Discord
                                    </Link>
                                </Button>
                            )}
                            <Button asChild variant="outline" className="h-11 px-5">
                                <Link
                                    href="https://github.com/Vansh-Bhardwaj/debridui"
                                    target="_blank"
                                    rel="noopener noreferrer">
                                    <Image
                                        src="https://cdn.jsdelivr.net/npm/simple-icons@v14/icons/github.svg"
                                        alt="GitHub logo"
                                        width={16}
                                        height={16}
                                        unoptimized
                                        className="size-4 dark:invert mr-2 opacity-70"
                                    />
                                    GitHub
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="px-6 py-20 md:px-12 md:py-32 lg:px-20 bg-muted/30">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-8">
                    <div>
                        <h2 className="text-2xl md:text-3xl font-light mb-2">Ready to start?</h2>
                        <p className="text-muted-foreground">Free, open source, and deployed at the edge.</p>
                    </div>
                    <Button asChild size="lg" className="h-12 px-8">
                        <Link href="/dashboard">
                            Open App
                            <ArrowRightIcon className="size-4 ml-2" />
                        </Link>
                    </Button>
                </div>
            </section>

            {/* Disclaimer */}
            <section className="px-6 py-12 md:px-12 lg:px-20 border-t border-border/50 bg-muted/20">
                <div className="max-w-6xl mx-auto">
                    <div className="max-w-2xl">
                        <h3 className="text-xs text-muted-foreground tracking-widest uppercase mb-3">
                            Important Notice
                        </h3>
                        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                            DebridUI is a client interface only and does not provide, host, or stream any content. It
                            connects to third-party debrid service APIs to display authorized users&apos; private files.
                            Users are solely responsible for ensuring their use complies with applicable laws and
                            service terms.
                        </p>
                        <Link
                            href="https://github.com/Vansh-Bhardwaj/debridui/blob/main/DISCLAIMER.md"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline underline-offset-4">
                            Read full disclaimer →
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="px-6 py-8 md:px-12 lg:px-20 border-t border-border/50">
                <div className="max-w-6xl mx-auto space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                        <div className="flex items-center gap-3">
                            <Image
                                className="dark:invert h-4 w-auto opacity-70"
                                src="/logo.svg"
                                alt="DebridUI"
                                width={80}
                                height={26}
                            />
                            <span className="text-xs text-muted-foreground">© {new Date().getFullYear()} DebridUI</span>
                        </div>

                        <nav className="flex items-center gap-6 text-sm">
                            <Link
                                href="https://github.com/Vansh-Bhardwaj/debridui#readme"
                                target="_blank"
                                className="text-muted-foreground hover:text-foreground transition-colors">
                                Docs
                            </Link>
                            <Link
                                href="/status"
                                className="text-muted-foreground hover:text-foreground transition-colors">
                                Status
                            </Link>
                            <Link
                                href="https://github.com/Vansh-Bhardwaj/debridui/issues"
                                target="_blank"
                                className="text-muted-foreground hover:text-foreground transition-colors">
                                Issues
                            </Link>
                            <Link
                                href="https://github.com/Vansh-Bhardwaj/debridui/blob/main/LICENSE"
                                target="_blank"
                                className="text-muted-foreground hover:text-foreground transition-colors">
                                GPL-3.0
                            </Link>
                        </nav>
                    </div>
                    <p className="text-xs text-muted-foreground/60 text-center md:text-left">
                        Built on the foundation of{" "}
                        <Link
                            href="https://github.com/viperadnan-git/debridui"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-muted-foreground transition-colors underline underline-offset-2">
                            viperadnan/debridui
                        </Link>
                    </p>
                </div>
            </footer>
        </div>
    );
}
