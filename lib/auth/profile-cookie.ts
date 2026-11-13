export class OwnershipCache {
    private entries = new Map<string, number>();
    constructor(private ttl = 30_000, private capacity = 500) {}
    has(userId: string, profileId: string, now = Date.now()) {
        const key = `${userId}:${profileId}`;
        const expires = this.entries.get(key);
        if (expires === undefined) return false;
        if (expires <= now) { this.entries.delete(key); return false; }
        return true;
    }
    add(userId: string, profileId: string, now = Date.now()) {
        if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(`${userId}:${profileId}`, now + this.ttl);
    }
    invalidate(userId: string, profileId: string) { this.entries.delete(`${userId}:${profileId}`); }
}

// Bind signatures to both the user and purpose, so another login cannot reuse a cookie.
const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;
function keyFor(secret: string) {
    if (!secret) throw new Error("Profile signing secret is required");
    if (cachedKey?.secret !== secret) cachedKey = { secret, key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) };
    return cachedKey.key;
}
export async function signProfile(userId: string, profileId: string, secret: string) {
    const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(`dui-profile:${userId}:${profileId}`));
    return `${profileId}.${Buffer.from(signature).toString("base64url")}`;
}
export async function verifyProfile(value: string | undefined, userId: string, secret: string): Promise<string | null> {
    if (!value || value.length > 100) return null;
    const [id, signature, extra] = value.split(".");
    if (extra !== undefined || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? "")) return null;
    const valid = await crypto.subtle.verify("HMAC", await keyFor(secret), Buffer.from(signature, "base64url"), encoder.encode(`dui-profile:${userId}:${id}`));
    return valid ? id : null;
}
