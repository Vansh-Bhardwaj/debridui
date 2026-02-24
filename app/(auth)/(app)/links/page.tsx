"use client";

import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { SectionDivider } from "@/components/common/section-divider";
import { RefreshCw, Link2 } from "lucide-react";
import { WebDownloadsProvider, useWebDownloads } from "@/components/web-downloads/web-downloads-provider";
import { useSettingsStore } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";
import { AddLinksForm } from "@/components/web-downloads/add-links-form";
import { DownloadList } from "@/components/web-downloads/download-list";

function LinksContent() {
    const { refetch, isRefetching, isLoading } = useWebDownloads();
    const tvMode = useSettingsStore((s) => s.settings.tvMode);

    return (
        <div className={cn(
            "mx-auto w-full space-y-8 pb-16",
            tvMode ? "max-w-6xl" : "max-w-4xl"
        )}>
            <PageHeader
                icon={Link2}
                title="Links"
                description="Unlock and download files from supported hosters"
                action={
                    <Button onClick={() => refetch()} disabled={isRefetching || isLoading} variant="outline">
                        <RefreshCw className={`size-4 ${isRefetching ? "animate-spin" : ""}`} />
                        Refresh
                    </Button>
                }
            />

            <section className="space-y-4" data-tv-section>
                <SectionDivider label="Add Links" />
                <AddLinksForm />
            </section>

            <section className="space-y-4" data-tv-section>
                <SectionDivider label="Downloads" />
                <DownloadList />
            </section>
        </div>
    );
}

export default function LinksPage() {
    return (
        <WebDownloadsProvider>
            <LinksContent />
        </WebDownloadsProvider>
    );
}
