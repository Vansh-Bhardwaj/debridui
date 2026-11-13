"use client";

import { useLocalWatchlist, useSetLocalWatchlist } from "@/hooks/use-local-watchlist";
import { MediaCard } from "./media-card";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState, EmptyState } from "@/components/common/async-state";
import { toast } from "sonner";

export function LocalWatchlist() {
    const { data, isLoading, error, refetch } = useLocalWatchlist();
    const remove = useSetLocalWatchlist();
    if (isLoading) return <LoadingState label="Loading My List…" />;
    if (error) return <div className="space-y-4"><ErrorState title="Could not load My List" description="Please try again in a moment." /><Button data-tv-focusable onClick={() => refetch()}>Retry</Button></div>;
    if (!data?.length) return <EmptyState title="Your list is empty" description="Save movies and shows from their detail pages." />;
    return <div data-tv-section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">{data.map((r) => <div key={r.id} className="space-y-2">
        <MediaCard media={r.media} type={r.type} />
        <p className="text-sm truncate">{r.media.title}</p>
        <Button data-tv-focusable variant="outline" className="w-full min-h-phone-touch" disabled={remove.isPending} onClick={() => remove.mutate({ media: r.media, type: r.type, saved: false }, { onError: () => toast.error("Could not remove title") })} aria-label={`Remove ${r.media.title} from My List`}>Remove</Button>
    </div>)}</div>;
}
