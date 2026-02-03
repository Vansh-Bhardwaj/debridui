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
