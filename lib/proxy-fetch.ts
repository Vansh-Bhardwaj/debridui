import { getCfEnv, getEnv } from "@/lib/env";
import { CORS_PROXY_URL } from "@/lib/constants";

interface ServiceBinding {
    fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Server-side fetch through the CORS proxy worker. Used as a fallback when an
 * upstream (e.g. Trakt's WAF) blocks the main worker. Prefers the CORS_PROXY
 * service binding: a worker can't reliably fetch another worker on the same
 * account over its public workers.dev URL, and the binding skips the network hop.
 */
export function fetchViaProxy(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const secret = getEnv("SIGNING_SECRET");
    if (secret) headers.set("x-proxy-key", secret);

    const target = `${getEnv("NEXT_PUBLIC_CORS_PROXY_URL") || CORS_PROXY_URL}${encodeURIComponent(url)}`;
    const binding = getCfEnv()?.CORS_PROXY as ServiceBinding | undefined;
    return (binding ?? globalThis).fetch(target, { ...init, headers });
}
