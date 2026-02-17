import "@/lib/polyfills";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Providers from "./providers";
import { cn } from "@/lib/utils";
import { Analytics } from "@/components/common/analytics";

const siteConfig = {
    name: "DebridUI",
    description:
        "A modern debrid client with built-in playback, continue watching, subtitle support, and media discovery — edge-deployed on Cloudflare Workers.",
    url: "https://debrid.indevs.in",
    ogImage: "/banner.jpg",
    keywords: [
        "debrid",
        "debrid ui",
        "debrid client",
        "real debrid",
        "torbox",
        "alldebrid",
        "file manager",
        "media streaming",
        "download manager",
        "trakt",
        "media discovery",
        "continue watching",
        "subtitle support",
        "cloudflare workers",
    ],
};

export const viewport: Viewport = {
    viewportFit: "cover",
};

export const metadata: Metadata = {
    metadataBase: new URL(siteConfig.url),
    alternates: {
        canonical: "/",
    },
    title: {
        default: siteConfig.name,
        template: `%s | ${siteConfig.name}`,
    },
    description: siteConfig.description,
    keywords: siteConfig.keywords,
    authors: [
        { name: "Vansh Bhardwaj", url: "https://github.com/Vansh-Bhardwaj" },
        { name: "Adnan Ahmad", url: "https://viperadnan.com" },
    ],
    creator: "Vansh Bhardwaj",
    openGraph: {
        type: "website",
        locale: "en_US",
        url: siteConfig.url,
        title: siteConfig.name,
        description: siteConfig.description,
        siteName: siteConfig.name,
        images: [
            {
                url: siteConfig.ogImage,
                width: 1200,
                height: 630,
                alt: siteConfig.name,
            },
        ],
    },
    twitter: {
        card: "summary_large_image",
        title: siteConfig.name,
        description: siteConfig.description,
        images: [siteConfig.ogImage],
        creator: "@viperadn",
    },
    robots: {
        index: true,
        follow: true,
        googleBot: {
            index: true,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
            "max-snippet": -1,
        },
    },
    icons: {
        icon: "/icon.svg",
        apple: "/icon.svg",
    },
    manifest: "/manifest.json",
    other: {
        "mobile-web-app-capable": "yes",
        "apple-mobile-web-app-capable": "yes",
        "apple-mobile-web-app-status-bar-style": "black-translucent",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <meta name="theme-color" content="#09090b" />
                <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
                <link rel="preconnect" href="https://wsrv.nl" />
                <link rel="preconnect" href="https://walter.trakt.tv" />
                <link rel="preload" href="https://cdn.jsdelivr.net/gh/viperadnan-git/fonts@main/public/styrene/StyreneB-Regular-Trial.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
            </head>
            <body className={cn("font-sans antialiased")}>
                <Script id="polyfill-name" strategy="beforeInteractive">
                    {`
                    (function() {
                        var g = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : {};
                        if (typeof g.__name === "undefined") {
                            g.__name = function(fn, name) {
                                try {
                                    Object.defineProperty(fn, "name", { value: name, configurable: true });
                                } catch (e) {}
                                return fn;
                            };
                        }
                    })();
                    `}
                </Script>
                <Providers>{children}</Providers>
                <Analytics />
                <Script id="sw-register" strategy="lazyOnload">
                    {`if("serviceWorker"in navigator){navigator.serviceWorker.register("/sw.js")}`}
                </Script>
            </body>
        </html>
    );
}
