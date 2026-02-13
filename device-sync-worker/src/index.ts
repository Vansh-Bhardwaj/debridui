/**
 * DeviceSync Durable Object — WebSocket relay for cross-device playback control.
 *
 * One instance per user. Devices connect via WebSocket, commands are relayed
 * between them in real-time. Uses Hibernation API for zero idle cost.
 *
 * Free tier budget: 100K DO requests/day, WS messages at 20:1 billing ratio.
 * A 2-hour session with 100 commands costs ~5 billed requests.
 */

import { DurableObject } from "cloudflare:workers";

// ── Protocol Types ─────────────────────────────────────────────────────────

interface DeviceInfo {
    id: string;
    name: string;
    deviceType: "desktop" | "mobile" | "tablet" | "tv";
    browser: string;
    isPlaying: boolean;
    nowPlaying: NowPlayingInfo | null;
    lastSeen: number;
}

interface NowPlayingInfo {
    title: string;
    imdbId?: string;
    type?: "movie" | "show";
    season?: number;
    episode?: number;
    progress: number; // seconds
    duration: number; // seconds
    paused: boolean;
    url?: string;
}

type ClientMessage =
    | { type: "register"; device: Omit<DeviceInfo, "isPlaying" | "nowPlaying" | "lastSeen"> }
    | { type: "now-playing"; state: NowPlayingInfo | null }
    | { type: "command"; target: string; action: string; payload?: Record<string, unknown> }
    | { type: "transfer"; target: string; playback: TransferPayload }
    | { type: "ping" };

interface TransferPayload {
    url: string;
    title: string;
    imdbId?: string;
    mediaType?: "movie" | "show";
    season?: number;
    episode?: number;
    subtitles?: Array<{ url: string; lang: string; name?: string }>;
    progressSeconds?: number;
    durationSeconds?: number;
}

type ServerMessage =
    | { type: "devices"; devices: DeviceInfo[] }
    | { type: "command"; from: string; fromName: string; action: string; payload?: Record<string, unknown> }
    | { type: "transfer"; from: string; fromName: string; playback: TransferPayload }
    | { type: "device-joined"; device: DeviceInfo }
    | { type: "device-left"; deviceId: string }
    | { type: "now-playing-update"; deviceId: string; state: NowPlayingInfo | null }
    | { type: "error"; message: string }
    | { type: "pong" };

// ── Durable Object ────────────────────────────────────────────────────────

export class DeviceSync extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        // Auto-respond to pings without waking the DO (free, no billing)
        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
        );
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected WebSocket upgrade", { status: 426 });
        }

        const url = new URL(request.url);
        const deviceId = url.searchParams.get("deviceId");
        if (!deviceId) {
            return new Response("Missing deviceId", { status: 400 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // Accept with hibernation — DO sleeps when idle, wakes on messages
        this.ctx.acceptWebSocket(server);

        // Attach device identity to the WebSocket (persists through hibernation)
        server.serializeAttachment({ deviceId, registered: false });

        return new Response(null, { status: 101, webSocket: client });
    }

    // ── WebSocket Hibernation Handlers ─────────────────────────────────

    async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
        if (typeof raw !== "string") return;

        let msg: ClientMessage;
        try {
            msg = JSON.parse(raw);
        } catch {
            this.send(ws, { type: "error", message: "Invalid JSON" });
            return;
        }

        const attachment = ws.deserializeAttachment() as { deviceId: string; device?: DeviceInfo; registered: boolean } | null;
        if (!attachment) return;

        switch (msg.type) {
            case "register":
                this.handleRegister(ws, attachment, msg);
                break;
            case "now-playing":
                this.handleNowPlaying(ws, attachment, msg);
                break;
            case "command":
                this.handleCommand(ws, attachment, msg);
                break;
            case "transfer":
                this.handleTransfer(ws, attachment, msg);
                break;
            // "ping" is handled by auto-response (never reaches here)
        }
    }

    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
        const attachment = ws.deserializeAttachment() as { deviceId: string } | null;
        if (!attachment) return;

        ws.close();

        // Broadcast device departure to remaining connections
        this.broadcast({
            type: "device-left",
            deviceId: attachment.deviceId,
        }, ws);

        // Also send updated full device list
        this.broadcastDeviceList(ws);
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        const attachment = ws.deserializeAttachment() as { deviceId: string } | null;
        if (attachment) {
            this.broadcast({ type: "device-left", deviceId: attachment.deviceId }, ws);
        }
        ws.close(1011, "WebSocket error");
    }

    // ── Message Handlers ───────────────────────────────────────────────

    private handleRegister(
        ws: WebSocket,
        attachment: { deviceId: string; registered: boolean },
        msg: Extract<ClientMessage, { type: "register" }>
    ): void {
        const device: DeviceInfo = {
            ...msg.device,
            id: attachment.deviceId,
            isPlaying: false,
            nowPlaying: null,
            lastSeen: Date.now(),
        };

        // Store device info in attachment (survives hibernation)
        ws.serializeAttachment({
            deviceId: attachment.deviceId,
            device,
            registered: true,
        });

        // Notify everyone about the new device
        this.broadcast({ type: "device-joined", device }, ws);

        // Send full device list to the newly connected device
        this.send(ws, { type: "devices", devices: this.getConnectedDevices() });
    }

    private handleNowPlaying(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo; registered: boolean },
        msg: Extract<ClientMessage, { type: "now-playing" }>
    ): void {
        if (!attachment.device) return;

        // Update the device's now-playing state
        const updated: DeviceInfo = {
            ...attachment.device,
            isPlaying: msg.state !== null && !msg.state.paused,
            nowPlaying: msg.state,
            lastSeen: Date.now(),
        };

        ws.serializeAttachment({ ...attachment, device: updated });

        // Broadcast to all other devices
        this.broadcast({
            type: "now-playing-update",
            deviceId: attachment.deviceId,
            state: msg.state,
        }, ws);
    }

    private handleCommand(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo },
        msg: Extract<ClientMessage, { type: "command" }>
    ): void {
        const targetWs = this.findWebSocket(msg.target);
        if (!targetWs) {
            this.send(ws, { type: "error", message: "Target device not found" });
            return;
        }

        this.send(targetWs, {
            type: "command",
            from: attachment.deviceId,
            fromName: attachment.device?.name ?? "Unknown",
            action: msg.action,
            payload: msg.payload,
        });
    }

    private handleTransfer(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo },
        msg: Extract<ClientMessage, { type: "transfer" }>
    ): void {
        const targetWs = this.findWebSocket(msg.target);
        if (!targetWs) {
            this.send(ws, { type: "error", message: "Target device not found" });
            return;
        }

        this.send(targetWs, {
            type: "transfer",
            from: attachment.deviceId,
            fromName: attachment.device?.name ?? "Unknown",
            playback: msg.playback,
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────

    private getConnectedDevices(): DeviceInfo[] {
        const devices: DeviceInfo[] = [];
        for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as { device?: DeviceInfo; registered?: boolean } | null;
            if (att?.device && att.registered) {
                devices.push({ ...att.device, lastSeen: Date.now() });
            }
        }
        return devices;
    }

    private findWebSocket(deviceId: string): WebSocket | null {
        for (const ws of this.ctx.getWebSockets()) {
            const att = ws.deserializeAttachment() as { deviceId?: string } | null;
            if (att?.deviceId === deviceId) return ws;
        }
        return null;
    }

    private broadcast(msg: ServerMessage, exclude?: WebSocket): void {
        const data = JSON.stringify(msg);
        for (const ws of this.ctx.getWebSockets()) {
            if (ws === exclude) continue;
            try {
                ws.send(data);
            } catch {
                // Dead socket — will be cleaned up by webSocketClose
            }
        }
    }

    private broadcastDeviceList(exclude?: WebSocket): void {
        this.broadcast({ type: "devices", devices: this.getConnectedDevices() }, exclude);
    }

    private send(ws: WebSocket, msg: ServerMessage): void {
        try {
            ws.send(JSON.stringify(msg));
        } catch {
            // Dead socket
        }
    }
}

// ── Env type ───────────────────────────────────────────────────────────────

interface Env {
    DEVICE_SYNC: DurableObjectNamespace<DeviceSync>;
    SYNC_TOKEN_SECRET: string;
    ALLOWED_ORIGINS: string;
}

// ── Worker Entry Point ─────────────────────────────────────────────────────

async function verifyToken(token: string, secret: string): Promise<string | null> {
    // Token format: base64(userId:timestamp):hmac
    try {
        const [payloadB64, signature] = token.split(":");
        if (!payloadB64 || !signature) return null;

        const payload = atob(payloadB64);
        const [userId, timestampStr] = payload.split("|");
        if (!userId || !timestampStr) return null;

        const timestamp = parseInt(timestampStr, 10);
        if (isNaN(timestamp)) return null;

        // Token expires after 24 hours
        const age = Date.now() - timestamp;
        if (age > 24 * 60 * 60 * 1000 || age < 0) return null;

        // Verify HMAC-SHA256
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );

        const expected = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(payloadB64)
        );

        // Convert to hex for comparison
        const expectedHex = Array.from(new Uint8Array(expected))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

        // Timing-safe comparison
        if (expectedHex.length !== signature.length) return null;
        let mismatch = 0;
        for (let i = 0; i < expectedHex.length; i++) {
            mismatch |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
        }
        if (mismatch !== 0) return null;

        return userId;
    } catch {
        return null;
    }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
    const origin = request.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());

    if (!allowed.includes(origin)) {
        return {};
    }

    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Vary": "Origin",
    };
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const cors = corsHeaders(request, env);

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: cors });
        }

        // Only accept WebSocket upgrades on /ws path
        if (url.pathname !== "/ws") {
            return new Response("Not found", { status: 404, headers: cors });
        }

        // Verify auth token from query param
        const token = url.searchParams.get("token");
        if (!token) {
            return new Response("Missing token", { status: 401, headers: cors });
        }

        const userId = await verifyToken(token, env.SYNC_TOKEN_SECRET);
        if (!userId) {
            return new Response("Invalid or expired token", { status: 403, headers: cors });
        }

        // Route to the user's Durable Object (one per user)
        const doId = env.DEVICE_SYNC.idFromName(userId);
        const stub = env.DEVICE_SYNC.get(doId);

        // Forward the WebSocket upgrade to the DO
        return stub.fetch(request);
    },
} satisfies ExportedHandler<Env>;
