import { describe, expect, test } from "bun:test";
import { normalizeTorBoxAccount, type TorBoxUser } from "../lib/clients/torbox";

const user = (changes: Partial<TorBoxUser> = {}): TorBoxUser => ({
    id: 1, auth_id: "test", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    email: "test@example.com", plan: 2, premium_expires_at: "2099-01-01T00:00:00Z", ...changes,
});

describe("TorBox account normalization", () => {
    test("uses documented plan IDs, including Standard after Pro", () => {
        for (const [tier, name, slots] of [[0, "Free", 1], [1, "Essential", 3], [2, "Pro", 10], [3, "Standard", 5]] as const) {
            const result = normalizeTorBoxAccount(user({ plan: tier, additional_concurrent_slots: 2 }));
            expect(result.planName).toBe(name);
            expect(result.maxSlots).toBe(slots + 2);
            expect(result.transcodeAllowed).toBe(tier === 2);
        }
    });
    test("paid-through Pro works without recurring billing", () => {
        expect(normalizeTorBoxAccount(user({ is_subscribed: false })).transcodeAllowed).toBe(true);
    });
    test("unknown, missing or expired capabilities fail closed", () => {
        for (const changes of [{ plan: 99 }, { premium_expires_at: null }, { premium_expires_at: "invalid" }, { premium_expires_at: "2000-01-01" }]) {
            expect(normalizeTorBoxAccount(user(changes)).transcodeAllowed).toBe(false);
        }
        const result = normalizeTorBoxAccount(user({ plan: 99 }));
        expect(result.maxSlots).toBeNull();
        expect(result.activeSlots).toBeNull();
        expect(result.server).toBeNull();
    });
    test("keeps byte totals separate from item counts and sums live usage", () => {
        const result = normalizeTorBoxAccount(user({ total_downloaded: 5, total_bytes_downloaded: 100, total_bytes_uploaded: 40, is_subscribed: true }),
            { general: { total_downloaded: 200, total_uploaded: 80 } },
            [{ active: 2, queued: 3 }, { active: 1, queued: 4 }, { active: 0, queued: 1 }]);
        expect(result.totalDownloaded).toBe(200);
        expect(result.totalUploaded).toBe(80);
        expect(result.activeSlots).toBe(3);
        expect(result.queued).toBe(8);
        expect(result.renewal).toBe(true);
        expect(normalizeTorBoxAccount(user({ total_downloaded: 5 })).totalDownloaded).toBeNull();
    });
    test("partial stats use documented user byte fields without inventing usage", () => {
        const result = normalizeTorBoxAccount(user({ total_bytes_downloaded: 0, total_bytes_uploaded: 99 }), null, [{ active: 1, queued: 0 }]);
        expect(result.totalDownloaded).toBe(0);
        expect(result.totalUploaded).toBe(99);
        expect(result.activeSlots).toBeNull();
    });
});
