import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * GET /api/remote/token — Generate HMAC-signed token for device sync WebSocket auth.
 *
 * Token format: base64(userId|timestamp):hmacHex
 * Valid for 24 hours. Uses SYNC_TOKEN_SECRET (shared with sync worker).
 */
export async function GET() {
    const { data: session } = await auth.getSession();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = process.env.SYNC_TOKEN_SECRET;
    if (!secret) {
        return NextResponse.json({ error: "SYNC_TOKEN_SECRET not configured" }, { status: 500 });
    }

    try {
        const userId = session.user.id;
        const timestamp = Date.now().toString();
        const payloadB64 = btoa(`${userId}|${timestamp}`);

        // HMAC-SHA256 sign the payload
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const signature = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(payloadB64)
        );

        // Convert to hex
        const signatureHex = Array.from(new Uint8Array(signature))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        const token = `${payloadB64}:${signatureHex}`;

        return NextResponse.json(
            { token },
            {
                headers: {
                    "Cache-Control": "private, max-age=3600", // Cache 1hr (token valid 24hr)
                },
            }
        );
    } catch (error) {
        console.error("[remote/token] Error:", error);
        return NextResponse.json({ error: "Failed to generate token" }, { status: 500 });
    }
}
