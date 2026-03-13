"use client";
export const dynamic = "force-static";

import { useTraktMedia } from "@/hooks/use-trakt";
import { useParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { memo, useEffect } from "react";
import { MdbFooter } from "@/components/mdb/mdb-footer";
import { MediaDetails } from "@/components/mdb/media-details";
import { useSettingsStore } from "@/lib/stores/settings";

const ShowPage = memo(function ShowPage() {
    const params = useParams();
    const router = useRouter();
    const slug = params.slug as string;
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    const { data, isLoading, error } = useTraktMedia(slug, "show");

    useEffect(() => {
        if (data?.ids?.slug && data.ids.slug !== slug && slug.includes("-tmdb-")) {
            // Replace pseudo TMDB slug with the official Trakt slug immediately
            router.replace(`/shows/${data.ids.slug}`);
        }
    }, [data, slug, router]);

    return (
        <div className="w-full lg:px-6 max-w-6xl mx-auto">
            <MediaDetails media={data} mediaId={slug} type="show" isLoading={isLoading} error={error} />
            {!tvMode && <MdbFooter className="py-12 mt-8 border-t border-border/50" />}
        </div>
    );
});

export default ShowPage;
