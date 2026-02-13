import type { NextConfig } from "next";

const disableImageOptimization =
    process.env.NEXT_DISABLE_IMAGE_OPTIMIZATION === "true" || process.platform === "win32";

const securityHeaders = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains; preload" }]
        : []),
];

const nextConfig: NextConfig = {
    output: "standalone",
    reactStrictMode: true,
    poweredByHeader: false,
    images: {
        unoptimized: disableImageOptimization,
    },
    env: {
        NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
        // Ensure NEXT_PUBLIC vars from wrangler.jsonc are inlined at build time
        // (wrangler vars are only available at runtime on the server, not client-side)
        NEXT_PUBLIC_DEVICE_SYNC_URL: process.env.NEXT_PUBLIC_DEVICE_SYNC_URL ?? "https://debridui-sync.vanshbh7102-619.workers.dev",
    },
    async headers() {
        return [
            {
                source: "/:path*",
                headers: securityHeaders,
            },
        ];
    },
};

export default nextConfig;
