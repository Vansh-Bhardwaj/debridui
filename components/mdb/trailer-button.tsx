"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Play } from "reicon-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProfile } from "@/hooks/use-profile";
import { fetchCinemetaMeta } from "@/lib/cinemeta";

export function TrailerButton({ url, title, imdbId, type }: { url?: string; title: string; imdbId?: string; type: "movie" | "show" }) {
    const [open, setOpen] = useState(false);
    const { activeProfile } = useProfile();
    const { data } = useQuery({
        queryKey: ["detail-trailer", activeProfile.id, type, imdbId],
        queryFn: async () => (await fetchCinemetaMeta(imdbId!, type))?.trailers?.[0]?.source ?? null,
        enabled: !url && !!imdbId,
        staleTime: 86400000,
        refetchOnWindowFocus: false,
    });
    const trailerUrl = url || (data && /^[\w-]{11}$/.test(data) ? `https://youtu.be/${data}` : data);
    let id: string | null = null;
    try {
        const parsed = new URL(trailerUrl || "");
        if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"].includes(parsed.hostname)) id = parsed.searchParams.get("v") || parsed.pathname.split("/").pop() || null;
        else if (parsed.hostname === "youtu.be") id = parsed.pathname.slice(1);
    } catch { /* Invalid trailers are omitted. */ }
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button data-tv-focusable variant="outline" className="gap-2 min-h-phone-touch"><Play className="size-4" />Trailer</Button></DialogTrigger>
        <DialogContent showCloseButton={false} className="sm:max-w-4xl" data-tv-section>
            <DialogTitle>{title} · Trailer</DialogTitle>
            {open && <iframe title={`${title} trailer`} src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`} className="aspect-video w-full" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen data-tv-focusable />}
            <DialogClose asChild><Button data-tv-focusable variant="outline" className="min-h-phone-touch">Close trailer</Button></DialogClose>
        </DialogContent>
    </Dialog>;
}
