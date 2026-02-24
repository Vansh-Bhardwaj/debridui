"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { SearchDialog } from "@/components/mdb/search-dialog";
import { MdbFooter } from "@/components/mdb/mdb-footer";
import { memo, useState, useCallback, useEffect, useRef } from "react";
import {
    useTraktTrendingMovies,
    useTraktTrendingShows,
    useTraktPopularMovies,
    useTraktPopularShows,
    useTraktMostWatchedMovies,
    useTraktMostWatchedShows,
    useTraktAnticipatedMovies,
    useTraktAnticipatedShows,
    useTraktBoxOfficeMovies,
    useTraktRecommendations,
} from "@/hooks/use-trakt";
import { traktClient } from "@/lib/trakt";
import {
    useAddonCatalogDefs,
    useAddonCatalog,
    catalogSlug,
    type AddonCatalogDef,
} from "@/hooks/use-addons";
import { SearchIcon, Sparkles, Film, TrendingUp, Calendar, Ticket, Puzzle, Heart } from "lucide-react";
import { DISCORD_URL } from "@/lib/constants";
import { HeroCarouselSkeleton } from "@/components/mdb/hero-carousel-skeleton";
import { MediaSection } from "@/components/mdb/media-section";
import { SectionErrorBoundary } from "@/components/common/error-boundary";
import { useSettingsStore } from "@/lib/stores/settings";

const ContinueWatching = dynamic(
    () => import("@/components/mdb/continue-watching").then((m) => ({ default: m.ContinueWatching })),
    { ssr: false }
);

const HeroCarousel = dynamic(
    () => import("@/components/mdb/hero-carousel").then((m) => ({ default: m.HeroCarousel })),
    {
        loading: () => <HeroCarouselSkeleton />,
        ssr: false,
    }
);

// Welcome hero section with editorial minimalism
const WelcomeSection = memo(function WelcomeSection({ onSearchClick }: { onSearchClick: () => void }) {
    return (
        <section className="relative py-12 lg:py-20 lg:px-6">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Top row: Editorial label + social links */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="h-px w-8 bg-primary" />
                        <span className="text-xs tracking-widest uppercase text-muted-foreground">
                            Welcome to DebridUI
                        </span>
                    </div>
                    <div
                        className="flex items-center gap-1 animate-in fade-in-0 motion-reduce:animate-none"
                        style={{ animationDuration: "600ms", animationDelay: "400ms", animationFillMode: "backwards" }}>
                        {DISCORD_URL && (
                            <a
                                href={DISCORD_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Discord"
                                className="group size-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-300">
                                <Image
                                    src="https://simpleicons.org/icons/discord.svg"
                                    alt=""
                                    width={16}
                                    height={16}
                                    unoptimized
                                    className="size-4 opacity-50 dark:invert group-hover:opacity-100 transition-opacity duration-300"
                                />
                            </a>
                        )}
                        <a
                            href="https://github.com/Vansh-Bhardwaj/debridui"
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="GitHub"
                            className="group size-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-300">
                            <Image
                                src="https://simpleicons.org/icons/github.svg"
                                alt=""
                                width={16}
                                height={16}
                                unoptimized
                                className="size-4 opacity-50 dark:invert group-hover:opacity-100 transition-opacity duration-300"
                            />
                        </a>
                    </div>
                </div>

                {/* Headline with staggered animation */}
                <div className="space-y-2">
                    <h1
                        className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-light tracking-tight animate-in fade-in-0 slide-in-from-bottom-4 motion-reduce:animate-none"
                        style={{ animationDuration: "600ms" }}>
                        Discover
                    </h1>
                    <h1
                        className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-light tracking-tight text-muted-foreground animate-in fade-in-0 slide-in-from-bottom-4 motion-reduce:animate-none"
                        style={{ animationDuration: "600ms", animationDelay: "100ms", animationFillMode: "backwards" }}>
                        & Stream
                    </h1>
                </div>

                {/* Description */}
                <p
                    className="text-sm text-muted-foreground max-w-md leading-relaxed animate-in fade-in-0 motion-reduce:animate-none"
                    style={{ animationDuration: "600ms", animationDelay: "200ms", animationFillMode: "backwards" }}>
                    A modern debrid client for managing your files, discovering trending movies and shows — with addon
                    support and streaming to your preferred media player.
                </p>

                {/* Search bar */}
                <div
                    className="max-w-md animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
                    style={{ animationDuration: "600ms", animationDelay: "300ms", animationFillMode: "backwards" }}>
                    <button
                        onClick={onSearchClick}
                        className="group w-full flex items-center gap-3 h-11 px-4 text-sm text-muted-foreground bg-transparent hover:bg-muted/30 border border-border/50 hover:border-border rounded-sm transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <SearchIcon className="size-4 text-muted-foreground/60 group-hover:text-foreground transition-colors duration-300" />
                        <span className="flex-1 text-left">Search movies, shows, files...</span>
                        <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded-sm border border-border/50 bg-muted/30 px-2 font-mono text-xs text-muted-foreground">
                            ⌘K
                        </kbd>
                    </button>
                </div>
            </div>
        </section>
    );
});

// Stable icon references for memoized ContentSection
const ICON_PUZZLE = <Puzzle className="size-3.5" />;
const ICON_TRENDING = <TrendingUp className="size-3.5" />;
const ICON_SPARKLES = <Sparkles className="size-3.5" />;
const ICON_TICKET = <Ticket className="size-3.5" />;
const ICON_FILM = <Film className="size-3.5" />;
const ICON_CALENDAR = <Calendar className="size-3.5" />;
const ICON_HEART = <Heart className="size-3.5" />;

// Content section with modern divider
interface ContentSectionProps {
    label: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    delay?: number;
}

const ContentSection = memo(function ContentSection({ label, icon, children, delay = 0 }: ContentSectionProps) {
    return (
        <div
            className="space-y-8 animate-in fade-in-0 slide-in-from-bottom-4 motion-reduce:animate-none"
            data-tv-section
            style={{
                animationDelay: `${delay}ms`,
                animationDuration: "600ms",
                animationFillMode: "backwards",
            }}>
            {/* Section divider with animated accent */}
            <div className="flex items-center gap-4 py-2">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/50 to-border/50" />
                <div className="flex items-center gap-2.5 px-4 py-1.5 rounded-full border border-border/50 bg-card/50 backdrop-blur-sm">
                    {icon && <span className="text-primary">{icon}</span>}
                    <span className="text-xs tracking-widest uppercase text-muted-foreground">{label}</span>
                </div>
                <div className="h-px flex-1 bg-gradient-to-l from-transparent via-border/50 to-border/50" />
            </div>
            {children}
        </div>
    );
});

// ── Addon catalog components ────────────────────────────────────

/** Single addon catalog row — only fetches content when visible. */
const AddonCatalogRow = memo(function AddonCatalogRow({
    catalog,
    isVisible,
}: {
    catalog: AddonCatalogDef;
    isVisible: boolean;
}) {
    const { data, isLoading, error } = useAddonCatalog(catalog, isVisible);

    // Don't render anything until visible the first time
    if (!isVisible && !data) return null;

    return (
        <MediaSection
            title={catalog.name}
            items={data ?? undefined}
            isLoading={isLoading}
            error={error}
            rows={1}
            viewAllHref={`/discover/addon/${catalogSlug(catalog)}`}
        />
    );
});

/** Shows all browseable addon catalogs with lazy-loaded rows via IntersectionObserver. */
const AddonCatalogs = memo(function AddonCatalogs() {
    const { data: catalogs } = useAddonCatalogDefs();
    const [visible, setVisible] = useState<Set<string>>(new Set());
    const observerRef = useRef<IntersectionObserver | null>(null);

    const sentinelRef = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) return;
            const key = node.dataset.key;
            if (!key) return;
            if (!observerRef.current) {
                observerRef.current = new IntersectionObserver(
                    (entries) => {
                        const newKeys: string[] = [];
                        for (const entry of entries) {
                            if (entry.isIntersecting) {
                                const k = (entry.target as HTMLElement).dataset.key;
                                if (k) newKeys.push(k);
                            }
                        }
                        if (newKeys.length > 0) {
                            setVisible((prev) => {
                                const next = new Set(prev);
                                for (const k of newKeys) next.add(k);
                                return next;
                            });
                        }
                    },
                    { rootMargin: "100% 0px" }
                );
            }
            observerRef.current.observe(node);
        },
        []
    );

    // Cleanup observer on unmount
    useEffect(() => {
        return () => observerRef.current?.disconnect();
    }, []);

    if (!catalogs?.length) return null;

    return (
        <ContentSection label="From Your Addons" icon={ICON_PUZZLE}>
            {catalogs.map((cat) => {
                const key = catalogSlug(cat);
                return (
                    <div key={key} ref={sentinelRef} data-key={key}>
                        <AddonCatalogRow catalog={cat} isVisible={visible.has(key)} />
                    </div>
                );
            })}
        </ContentSection>
    );
});

/** Wrapper: defers its children's Trakt queries until the component scrolls into viewport. */
function LazyTraktSection({
    label,
    icon,
    delay,
    children,
}: {
    label: string;
    icon: React.ReactNode;
    delay: number;
    children: (visible: boolean) => React.ReactNode;
}) {
    const [visible, setVisible] = useState(false);
    const setRef = useCallback((node: HTMLDivElement | null) => {
        if (!node || visible) return;
        const io = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } },
            { rootMargin: "200% 0px" }
        );
        io.observe(node);
    }, [visible]);

    return (
        <div ref={setRef}>
            <ContentSection label={label} icon={icon} delay={delay}>
                {children(visible)}
            </ContentSection>
        </div>
    );
}

/** "For You" — personalized Trakt recommendations, only shown when genuinely personalized */
const ForYouSection = memo(function ForYouSection({ visible }: { visible: boolean }) {
    const isTraktConnected = !!traktClient.getAccessToken();
    const { data } = useTraktRecommendations(isTraktConnected && visible);
    if (!data?.isPersonalized || !data.items.length) return null;
    return (
        <MediaSection title="Movies & Shows" items={data.items} rows={1} />
    );
});

const PopularSection = memo(function PopularSection({ visible }: { visible: boolean }) {    const popularMovies = useTraktPopularMovies(20, visible);
    const popularShows = useTraktPopularShows(20, visible);
    return (
        <>
            <MediaSection title="Movies" items={popularMovies.data} isLoading={popularMovies.isLoading} error={popularMovies.error} />
            <MediaSection title="TV Shows" items={popularShows.data} isLoading={popularShows.isLoading} error={popularShows.error} />
        </>
    );
});

const BoxOfficeSection = memo(function BoxOfficeSection({ visible }: { visible: boolean }) {
    const boxOfficeMovies = useTraktBoxOfficeMovies(visible);
    return <MediaSection title="Top Grossing" items={boxOfficeMovies.data} isLoading={boxOfficeMovies.isLoading} error={boxOfficeMovies.error} />;
});

const MostWatchedSection = memo(function MostWatchedSection({ visible }: { visible: boolean }) {
    const mostWatchedMovies = useTraktMostWatchedMovies("weekly", 20, visible);
    const mostWatchedShows = useTraktMostWatchedShows("weekly", 20, visible);
    return (
        <>
            <MediaSection title="Movies" items={mostWatchedMovies.data} isLoading={mostWatchedMovies.isLoading} error={mostWatchedMovies.error} />
            <MediaSection title="TV Shows" items={mostWatchedShows.data} isLoading={mostWatchedShows.isLoading} error={mostWatchedShows.error} />
        </>
    );
});

const AnticipatedSection = memo(function AnticipatedSection({ visible }: { visible: boolean }) {
    const anticipatedMovies = useTraktAnticipatedMovies(20, visible);
    const anticipatedShows = useTraktAnticipatedShows(20, visible);
    return (
        <>
            <MediaSection title="Movies" items={anticipatedMovies.data} isLoading={anticipatedMovies.isLoading} error={anticipatedMovies.error} />
            <MediaSection title="TV Shows" items={anticipatedShows.data} isLoading={anticipatedShows.isLoading} error={anticipatedShows.error} />
        </>
    );
});

const DashboardPage = memo(function DashboardPage() {
    const [searchOpen, setSearchOpen] = useState(false);
    const handleSearchClick = useCallback(() => setSearchOpen(true), []);
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    // Above-the-fold: always fetch
    const trendingMovies = useTraktTrendingMovies(20);
    const trendingShows = useTraktTrendingShows(20);

    return (
        <div className="pb-12">
            {/* Hero Carousel — full bleed in TV mode */}
            <div className={tvMode ? "tv-hero-bleed" : undefined}>
                <SectionErrorBoundary section="Hero">
                    <HeroCarousel autoFocus />
                </SectionErrorBoundary>
            </div>

            {/* Welcome Section — hidden in TV mode */}
            {!tvMode && <WelcomeSection onSearchClick={handleSearchClick} />}

            <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />

            {/* Continue Watching */}
            <div className="lg:px-6 mb-8">
                <SectionErrorBoundary section="Continue Watching">
                    <ContinueWatching />
                </SectionErrorBoundary>
            </div>

            {/* Content Sections with lazy loading */}
            <div className="lg:px-6 space-y-16">
                {/* Addon Catalogs — lazy-loaded per-row */}
                <SectionErrorBoundary section="Addon Catalogs">
                    <AddonCatalogs />
                </SectionErrorBoundary>

                {/* For You — personalized recommendations (only shown when Trakt connected + has watch history) */}
                <LazyTraktSection label="For You" icon={ICON_HEART} delay={0}>
                    {(visible) => <ForYouSection visible={visible} />}
                </LazyTraktSection>

                {/* Trending */}
                <ContentSection label="Trending Now" icon={ICON_TRENDING} delay={0}>
                    <MediaSection
                        title="Movies"
                        items={trendingMovies.data}
                        isLoading={trendingMovies.isLoading}
                        error={trendingMovies.error}
                        showRank
                    />
                    <MediaSection
                        title="TV Shows"
                        items={trendingShows.data}
                        isLoading={trendingShows.isLoading}
                        error={trendingShows.error}
                        showRank
                    />
                </ContentSection>

                {/* Popular */}
                <LazyTraktSection label="Popular" icon={ICON_SPARKLES} delay={100}>
                    {(visible) => <PopularSection visible={visible} />}
                </LazyTraktSection>

                {/* Box Office */}
                <LazyTraktSection label="Box Office" icon={ICON_TICKET} delay={200}>
                    {(visible) => <BoxOfficeSection visible={visible} />}
                </LazyTraktSection>

                {/* Most Watched */}
                <LazyTraktSection label="Most Watched This Week" icon={ICON_FILM} delay={300}>
                    {(visible) => <MostWatchedSection visible={visible} />}
                </LazyTraktSection>

                {/* Coming Soon */}
                <LazyTraktSection label="Coming Soon" icon={ICON_CALENDAR} delay={400}>
                    {(visible) => <AnticipatedSection visible={visible} />}
                </LazyTraktSection>

                {/* Footer — hidden in TV mode */}
                {!tvMode && <MdbFooter className="pt-10 border-t border-border/50" />}
            </div>
        </div>
    );
});

export default DashboardPage;
