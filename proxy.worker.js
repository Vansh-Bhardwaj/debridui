/*
Universal CORS Proxy

This worker is used to proxy requests to the target URL and add CORS headers to the response.

Usage:
https://your-worker.workers.dev/?url=https://api.example.com/endpoint
*/

// eslint-disable-next-line import/no-anonymous-default-export
export default {
    async fetch(request) {
        // Configure allowed origins - add your domains here
        const ALLOWED_ORIGINS = [
            // "*", // Allow all origins (remove this for security)
            "http://localhost:3000", // For local development
            "https://debrid.indevs.in", // Production domain
        ];

        // Handle OPTIONS preflight immediately
        if (request.method === "OPTIONS") {
            const requestOrigin = request.headers.get("Origin");

            const isAllowed =
                requestOrigin && (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(requestOrigin));

            if (!isAllowed) {
                return new Response(null, { status: 403 });
            }

            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes("*") ? "*" : requestOrigin,
                    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
                    "Access-Control-Allow-Headers":
                        request.headers.get("Access-Control-Request-Headers") || "Content-Type,Authorization",
                    "Access-Control-Max-Age": "86400",
                },
            });
        }

        // Restrict to GET and HEAD methods only
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", { status: 405 });
        }

        const url = new URL(request.url);
        const targetUrl = url.searchParams.get("url");

        if (!targetUrl) {
            return new Response("Missing url parameter", { status: 400 });
        }

        const requestOrigin = request.headers.get("Origin");

        // Require Origin header — block requests without origin (curl, scripts)
        const isAllowed = requestOrigin && (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(requestOrigin));

        if (!isAllowed) {
            return new Response("Origin not allowed", { status: 403 });
        }

        // SSRF protection — block internal/private IPs
        try {
            const parsed = new URL(targetUrl);
            const hostname = parsed.hostname.toLowerCase();
            const decimalIpv4 = /^\d+$/.test(hostname)
                ? Number(hostname)
                : NaN;
            const normalizedDecimalIpv4 = Number.isInteger(decimalIpv4) && decimalIpv4 >= 0 && decimalIpv4 <= 0xffffffff
                ? `${(decimalIpv4 >>> 24) & 255}.${(decimalIpv4 >>> 16) & 255}.${(decimalIpv4 >>> 8) & 255}.${decimalIpv4 & 255}`
                : "";
            const ipv4Mapped = hostname.replace(/^\[|\]$/g, "").match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)?.[1] || "";
            const blocked =
                !!parsed.username ||
                !!parsed.password ||
                hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                hostname === "[::1]" ||
                hostname === "0.0.0.0" ||
                hostname.endsWith(".local") ||
                hostname.endsWith(".internal") ||
                hostname.endsWith(".localhost") ||
                hostname.endsWith(".localdomain") ||
                hostname.endsWith(".localtest.me") ||
                hostname.endsWith(".nip.io") ||
                hostname.endsWith(".sslip.io") ||
                hostname === "metadata.google.internal" ||
                hostname === "169.254.169.254" ||
                /^10\./.test(hostname) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
                /^192\.168\./.test(hostname) ||
                /^127\./.test(hostname) ||
                /^169\.254\./.test(normalizedDecimalIpv4) ||
                /^10\./.test(normalizedDecimalIpv4) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(normalizedDecimalIpv4) ||
                /^192\.168\./.test(normalizedDecimalIpv4) ||
                /^127\./.test(normalizedDecimalIpv4) ||
                /^169\.254\./.test(ipv4Mapped) ||
                /^10\./.test(ipv4Mapped) ||
                /^172\.(1[6-9]|2\d|3[01])\./.test(ipv4Mapped) ||
                /^192\.168\./.test(ipv4Mapped) ||
                /^127\./.test(ipv4Mapped);
            if (blocked) {
                return new Response("Blocked destination", { status: 403 });
            }
        } catch {
            return new Response("Invalid target URL", { status: 400 });
        }

        try {
            // Create clean headers — strip browser-specific headers that cause
            // upstream servers (e.g. Torrentio) to reject the request with 403.
            // Use browser-like defaults to bypass Cloudflare bot detection.
            const cleanHeaders = new Headers();
            const stripPrefixes = ["origin", "referer", "sec-", "cf-", "cookie", "host"];

            for (const [key, value] of request.headers) {
                if (!stripPrefixes.some((p) => key.toLowerCase().startsWith(p))) {
                    cleanHeaders.set(key, value);
                }
            }

            // Override user-agent with a browser-like value to avoid Cloudflare blocks
            cleanHeaders.set(
                "user-agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            );
            cleanHeaders.set("accept", "application/json, text/plain, */*");
            cleanHeaders.set("accept-language", "en-US,en;q=0.9");
            // Prevent any upstream HTTP caching — AIOStreams assembles results
            // dynamically and cached responses may contain partial data
            cleanHeaders.set("cache-control", "no-cache");
            cleanHeaders.set("pragma", "no-cache");

            const proxyRequest = new Request(targetUrl, {
                method: request.method,
                headers: cleanHeaders,
                redirect: "follow",
            });

            // Fetch from upstream
            const response = await fetch(proxyRequest);

            // Clone headers and remove CORS headers in one pass
            const headers = new Headers(response.headers);
            headers.delete("Access-Control-Allow-Origin");
            headers.delete("Access-Control-Allow-Methods");
            headers.delete("Access-Control-Allow-Headers");
            headers.delete("Access-Control-Allow-Credentials");
            headers.delete("Access-Control-Expose-Headers");
            headers.delete("Access-Control-Max-Age");

            // Set our CORS headers
            const allowOrigin = ALLOWED_ORIGINS.includes("*") ? "*" : requestOrigin;
            headers.set("Access-Control-Allow-Origin", allowOrigin);
            headers.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
            headers.set("Vary", "Origin");

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers,
            });
        } catch (error) {
            return new Response(`Proxy error: ${error.message}`, {
                status: 500,
                headers: {
                    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes("*") ? "*" : requestOrigin,
                },
            });
        }
    },
};
