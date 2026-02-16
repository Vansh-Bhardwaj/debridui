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
        // Safe: load external script via Next.js <Script> component
        return <Script src={src} strategy="afterInteractive" />;
    }

    // Inline script content: extract from <script>...</script> tags if present
    const inlineMatch = scriptTag.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const inlineCode = inlineMatch?.[1]?.trim();

    if (inlineCode) {
        return <Script id="analytics" strategy="afterInteractive">{inlineCode}</Script>;
    }

    return null;
}
