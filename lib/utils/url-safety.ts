/**
 * URL safety checks for SSRF protection.
 * Blocks requests to internal/private network addresses, cloud metadata endpoints,
 * and other sensitive destinations.
 */

const BLOCKED_HOSTNAMES = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "[::1]",
    "0.0.0.0",
    // Cloud metadata endpoints
    "metadata.google.internal",
    "metadata.google.com",
]);

const BLOCKED_SUFFIXES = [
    ".local",
    ".internal",
    ".localhost",
    ".localdomain",
    ".localtest.me",
    ".nip.io",
    ".sslip.io",
];

function normalizeIPv4FromDecimal(hostname: string): string | null {
    if (!/^\d+$/.test(hostname)) return null;
    const value = Number(hostname);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null;

    const a = (value >>> 24) & 255;
    const b = (value >>> 16) & 255;
    const c = (value >>> 8) & 255;
    const d = value & 255;
    return `${a}.${b}.${c}.${d}`;
}

function normalizeIPv4FromMappedIPv6(hostname: string): string | null {
    const ipv6 = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const match = ipv6.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    return match?.[1] ?? null;
}

/**
 * Check if a hostname is a private/internal IP address.
 * Covers RFC 1918 (10.x, 172.16-31.x, 192.168.x), link-local (169.254.x),
 * loopback (127.x), and IPv6 equivalents.
 */
function isPrivateIP(hostname: string): boolean {
    // IPv4 checks
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
        const [, a, b] = ipv4Match.map(Number);
        if (a === 10) return true;                          // 10.0.0.0/8
        if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
        if (a === 192 && b === 168) return true;             // 192.168.0.0/16
        if (a === 169 && b === 254) return true;             // 169.254.0.0/16 (link-local / cloud metadata)
        if (a === 127) return true;                          // 127.0.0.0/8
        if (a === 0) return true;                            // 0.0.0.0/8
        return false;
    }

    // IPv6 checks (bracket-wrapped or raw)
    const ipv6 = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (ipv6.startsWith("fc") || ipv6.startsWith("fd")) return true;   // ULA
    if (ipv6.startsWith("fe80")) return true;                            // Link-local
    if (ipv6 === "::1" || ipv6 === "::") return true;                    // Loopback / unspecified

    return false;
}

/**
 * Check if a URL points to a blocked/internal destination.
 * Returns true if the URL should be blocked.
 */
export function isBlockedUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        const hostname = url.hostname.toLowerCase();

        // Never allow embedded credentials in proxied URLs
        if (url.username || url.password) return true;

        if (BLOCKED_HOSTNAMES.has(hostname)) return true;
        if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;

        const decimalIPv4 = normalizeIPv4FromDecimal(hostname);
        if (decimalIPv4 && isPrivateIP(decimalIPv4)) return true;

        const mappedIPv4 = normalizeIPv4FromMappedIPv6(hostname);
        if (mappedIPv4 && isPrivateIP(mappedIPv4)) return true;

        if (isPrivateIP(hostname)) return true;

        return false;
    } catch {
        return true; // Invalid URLs are blocked
    }
}
