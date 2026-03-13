"use client";
export const dynamic = "force-static";

import lazyLoad from "next/dynamic";
import { useTraktMedia } from "@/hooks/use-trakt";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { memo, useEffect } from "react";
import { MdbFooter } from "@/components/mdb/mdb-footer";
import { useSettingsStore } from "@/lib/stores/settings";

// Lazy-loaded with ssr:false: the SSR output is already a loading skeleton (data
// is fetched client-side), so excluding the heavy component tree from the server
// bundle saves significant Worker bundle size.
const MediaDetails = lazyLoad(
    () => import("@/components/mdb/media-details").then((m) => ({ default: m.MediaDetails })),
    { ssr: false },
);

const MoviePage = memo(function MoviePage() {
    const params = useParams();
    const router = useRouter();
    const slug = params.slug as string;
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    const { data, isLoading, error } = useTraktMedia(slug, "movie");

    useEffect(() => {
        if (data?.ids?.slug && data.ids.slug !== slug && slug.includes("-tmdb-")) {
            // Replace pseudo TMDB slug with the official Trakt slug immediately
            router.replace(`/movies/${data.ids.slug}`);
        }
    }, [data, slug, router]);

    return (
        <div className="w-full lg:px-6 max-w-6xl mx-auto">
            <MediaDetails media={data} mediaId={slug} type="movie" isLoading={isLoading} error={error} />
            {!tvMode && <MdbFooter className="py-12 mt-8 border-t border-border/50" />}
        </div>
    );
});

export default MoviePage;
