import Script from "next/script";

export function Analytics() {
    const scriptTag = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT;

    if (!scriptTag) {
        return null;
    }

    // Extract src URL from script tag or use as direct URL
    const srcMatch = scriptTag.match(/src=["']([^"']+)["']/);
    const src = srcMatch?.[1] ?? (scriptTag.startsWith("http") ? scriptTag.trim() : null);

    if (src) {
        // Proxy external analytics scripts through our own domain to avoid
        // tracking prevention tools (e.g. Edge, uBlock) blocking them
        const proxiedSrc = src.startsWith("http") ? "/api/analytics/script" : src;
        return <Script src={proxiedSrc} strategy="afterInteractive" />;
    }

    // Inline script content: extract from <script>...</script> tags if present
    const inlineMatch = scriptTag.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const inlineCode = inlineMatch?.[1]?.trim();

    if (inlineCode) {
        return <Script id="analytics" strategy="afterInteractive">{inlineCode}</Script>;
    }

    return null;
}
