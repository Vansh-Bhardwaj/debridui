import { useQueries } from "@tanstack/react-query";
import { getOGProxyUrl } from "@/lib/signed-proxy";

interface OGMetadata {
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    favicon: string | null;
}

async function fetchOGMetadata(url: string): Promise<OGMetadata | null> {
    try {
        const endpoint = getOGProxyUrl(url);
        if (!endpoint) return null;
        const res = await fetch(endpoint);
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Fetch OG metadata for multiple URLs in parallel.
 * Limited to first 8 URLs to avoid excessive requests.
 */
export function useOGMetadata(urls: string[]) {
    const limited = urls.filter(Boolean).slice(0, 8);

    return useQueries({
        queries: limited.map((url) => ({
            queryKey: ["og-metadata", url],
            queryFn: () => fetchOGMetadata(url),
            staleTime: 24 * 60 * 60 * 1000,
            gcTime: 48 * 60 * 60 * 1000,
            retry: false,
        })),
    });
}
