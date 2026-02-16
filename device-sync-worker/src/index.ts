/**
 * DeviceSync Durable Object — WebSocket relay for cross-device playback control.
 *
 * One instance per user. Devices connect via WebSocket, commands are relayed
 * between them in real-time. Uses Hibernation API for zero idle cost.
 *
 * Features:
 *   - Remote playback control (play/pause/seek/volume/tracks/fullscreen)
 *   - Remote media browsing (request file list from target device)
 *   - Cross-device notifications
 *   - Shared playback queue (persisted in DO SQLite)
 *
 * Free tier budget: 100K DO requests/day, WS messages at 20:1 billing ratio.
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
    progress: number;
    duration: number;
    paused: boolean;
    url?: string;
}

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

interface QueueItem {
    id: string;
    title: string;
    url: string;
    imdbId?: string;
    mediaType?: "movie" | "show";
    season?: number;
    episode?: number;
    subtitles?: Array<{ url: string; lang: string; name?: string }>;
    addedBy: string;
    addedAt: number;
}

interface BrowseRequest {
    requestId: string;
    action: "list-files" | "search";
    query?: string;
    offset?: number;
    limit?: number;
}

interface BrowseResponse {
    requestId: string;
    files: Array<{ id: string; name: string; size: number; status: string; progress?: number; createdAt?: string }>;
    total?: number;
    hasMore?: boolean;
    error?: string;
}

interface DeviceNotification {
    id: string;
    title: string;
    description?: string;
    icon?: "download" | "play" | "info" | "warning" | "error";
    action?: { label: string; transferPayload?: TransferPayload };
    expiresAt?: number;
}

type ClientMessage =
    | { type: "register"; device: Omit<DeviceInfo, "isPlaying" | "nowPlaying" | "lastSeen"> }
    | { type: "now-playing"; state: NowPlayingInfo | null }
    | { type: "command"; target: string; action: string; payload?: Record<string, unknown> }
    | { type: "transfer"; target: string; playback: TransferPayload }
    | { type: "control-claim"; target: string }
    | { type: "control-release"; target: string }
    | { type: "browse-request"; target: string; request: BrowseRequest }
    | { type: "browse-response"; target: string; response: BrowseResponse }
    | { type: "notify"; notification: DeviceNotification }
    | { type: "queue-add"; item: Omit<QueueItem, "id" | "addedAt"> }
    | { type: "queue-remove"; itemId: string }
    | { type: "queue-clear" }
    | { type: "queue-reorder"; itemIds: string[] }
    | { type: "queue-get" }
    | { type: "ping" };

type ServerMessage =
    | { type: "devices"; devices: DeviceInfo[] }
    | { type: "command"; from: string; fromName: string; action: string; payload?: Record<string, unknown> }
    | { type: "transfer"; from: string; fromName: string; playback: TransferPayload }
    | { type: "device-joined"; device: DeviceInfo }
    | { type: "device-left"; deviceId: string }
    | { type: "now-playing-update"; deviceId: string; state: NowPlayingInfo | null }
    | { type: "control-claimed"; controllerId: string; controllerName: string }
    | { type: "control-released" }
    | { type: "browse-request"; from: string; request: BrowseRequest }
    | { type: "browse-response"; from: string; response: BrowseResponse }
    | { type: "notification"; from: string; fromName: string; notification: DeviceNotification }
    | { type: "queue-updated"; queue: QueueItem[] }
    | { type: "error"; message: string }
    | { type: "pong" };

// ── Durable Object ────────────────────────────────────────────────────────

export class DeviceSync extends DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);

        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
        );

        // Initialize queue table once per DO instantiation (including post-hibernation wake)
        ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS queue (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            )
        `);
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

        this.ctx.acceptWebSocket(server);
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

        // Runtime validation: reject messages with unknown types
        const validTypes = new Set([
            "register", "now-playing", "command", "transfer",
            "control-claim", "control-release", "browse-request", "browse-response",
            "notify", "queue-add", "queue-remove", "queue-clear", "queue-reorder", "queue-get",
        ]);
        if (!msg || typeof msg !== "object" || typeof msg.type !== "string" || !validTypes.has(msg.type)) {
            this.send(ws, { type: "error", message: "Invalid message type" });
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
            case "control-claim":
            case "control-release":
                this.handleControl(ws, attachment, msg);
                break;
            case "browse-request":
                this.handleBrowseRequest(ws, attachment, msg);
                break;
            case "browse-response":
                this.handleBrowseResponse(ws, attachment, msg);
                break;
            case "notify":
                this.handleNotify(ws, attachment, msg);
                break;
            case "queue-add":
                await this.handleQueueAdd(ws, attachment, msg);
                break;
            case "queue-remove":
                await this.handleQueueRemove(msg);
                break;
            case "queue-clear":
                await this.handleQueueClear();
                break;
            case "queue-reorder":
                await this.handleQueueReorder(msg);
                break;
            case "queue-get":
                await this.handleQueueGet(ws);
                break;
        }
    }

    async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
        const attachment = ws.deserializeAttachment() as { deviceId: string } | null;
        if (!attachment) return;

        ws.close();
        this.broadcast({ type: "device-left", deviceId: attachment.deviceId }, ws);
        this.broadcastDeviceList(ws);
    }

    async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
        const attachment = ws.deserializeAttachment() as { deviceId: string } | null;
        if (attachment) {
            this.broadcast({ type: "device-left", deviceId: attachment.deviceId }, ws);
        }
        ws.close(1011, "WebSocket error");
    }

    // ── Original Handlers ──────────────────────────────────────────────

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

        // Close stale sockets from the same physical device (same name + deviceType)
        // or same deviceId reconnecting. This handles iOS Safari which doesn't fire
        // beforeunload/WebSocket close when the page is killed, and ITP clearing
        // localStorage causing new deviceIds on each visit.
        for (const existing of this.ctx.getWebSockets()) {
            if (existing === ws) continue;
            const att = existing.deserializeAttachment() as { deviceId?: string; device?: DeviceInfo; registered?: boolean } | null;
            if (!att?.registered || !att.device) continue;
            if (
                att.deviceId === attachment.deviceId ||
                (att.device.name === device.name && att.device.deviceType === device.deviceType)
            ) {
                try {
                    existing.close(1000, "Replaced by new connection");
                } catch { /* already closed */ }
            }
        }

        ws.serializeAttachment({ deviceId: attachment.deviceId, device, registered: true });
        this.broadcast({ type: "device-joined", device }, ws);
        this.send(ws, { type: "devices", devices: this.getConnectedDevices() });
    }

    private handleNowPlaying(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo; registered: boolean },
        msg: Extract<ClientMessage, { type: "now-playing" }>
    ): void {
        if (!attachment.device) return;

        const updated: DeviceInfo = {
            ...attachment.device,
            isPlaying: msg.state !== null && !msg.state.paused,
            nowPlaying: msg.state,
            lastSeen: Date.now(),
        };

        ws.serializeAttachment({ ...attachment, device: updated });
        this.broadcast({ type: "now-playing-update", deviceId: attachment.deviceId, state: msg.state }, ws);
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

    private handleControl(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo },
        msg: Extract<ClientMessage, { type: "control-claim" }> | Extract<ClientMessage, { type: "control-release" }>
    ): void {
        const targetWs = this.findWebSocket(msg.target);
        if (!targetWs) {
            this.send(ws, { type: "error", message: "Target device not found" });
            return;
        }
        if (msg.type === "control-claim") {
            this.send(targetWs, {
                type: "control-claimed",
                controllerId: attachment.deviceId,
                controllerName: attachment.device?.name ?? "Unknown",
            });
        } else {
            this.send(targetWs, { type: "control-released" });
        }
    }

    // ── Browse Handlers ────────────────────────────────────────────────

    private handleBrowseRequest(
        ws: WebSocket,
        attachment: { deviceId: string },
        msg: Extract<ClientMessage, { type: "browse-request" }>
    ): void {
        const targetWs = this.findWebSocket(msg.target);
        if (!targetWs) {
            this.send(ws, { type: "error", message: "Target device not found" });
            return;
        }
        this.send(targetWs, { type: "browse-request", from: attachment.deviceId, request: msg.request });
    }

    private handleBrowseResponse(
        ws: WebSocket,
        attachment: { deviceId: string },
        msg: Extract<ClientMessage, { type: "browse-response" }>
    ): void {
        const targetWs = this.findWebSocket(msg.target);
        if (!targetWs) return;
        this.send(targetWs, { type: "browse-response", from: attachment.deviceId, response: msg.response });
    }

    // ── Notification Handler ───────────────────────────────────────────

    private handleNotify(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo },
        msg: Extract<ClientMessage, { type: "notify" }>
    ): void {
        // Broadcast notification to ALL devices (including sender — they may want the toast too)
        this.broadcast({
            type: "notification",
            from: attachment.deviceId,
            fromName: attachment.device?.name ?? "Unknown",
            notification: msg.notification,
        });
    }

    // ── Queue Handlers (persisted in DO SQLite) ────────────────────────

    private async handleQueueAdd(
        ws: WebSocket,
        attachment: { deviceId: string; device?: DeviceInfo },
        msg: Extract<ClientMessage, { type: "queue-add" }>
    ): Promise<void> {
        const id = crypto.randomUUID();
        const item: QueueItem = { ...msg.item, id, addedAt: Date.now() };

        // Single INSERT with inline MAX subquery (1 SQLite op instead of 2)
        this.ctx.storage.sql.exec(
            "INSERT INTO queue (id, data, sort_order) VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM queue))",
            id,
            JSON.stringify(item)
        );

        // Broadcast updated queue to all
        await this.broadcastQueue();
        void ws; void attachment; // Used for type narrowing
    }

    private async handleQueueRemove(msg: Extract<ClientMessage, { type: "queue-remove" }>): Promise<void> {
        this.ctx.storage.sql.exec("DELETE FROM queue WHERE id = ?", msg.itemId);
        await this.broadcastQueue();
    }

    private async handleQueueClear(): Promise<void> {
        this.ctx.storage.sql.exec("DELETE FROM queue");
        await this.broadcastQueue();
    }

    private async handleQueueReorder(msg: Extract<ClientMessage, { type: "queue-reorder" }>): Promise<void> {
        if (msg.itemIds.length === 0) return;

        // Validate: only allow UUIDs (prevents SQL injection via string interpolation)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validIds = msg.itemIds.filter(id => typeof id === "string" && uuidRegex.test(id));
        if (validIds.length === 0) return;

        // Use parameterized queries for CASE clauses to prevent injection
        const cases = validIds.map((_, i) => `WHEN ? THEN ${i}`).join(" ");
        const placeholders = validIds.map(() => "?").join(",");
        this.ctx.storage.sql.exec(
            `UPDATE queue SET sort_order = CASE id ${cases} END WHERE id IN (${placeholders})`,
            ...validIds,  // params for CASE WHENs
            ...validIds   // params for IN clause
        );
        await this.broadcastQueue();
    }

    private async handleQueueGet(ws: WebSocket): Promise<void> {
        const queue = this.getQueue();
        this.send(ws, { type: "queue-updated", queue });
    }

    private getQueue(): QueueItem[] {
        const rows = this.ctx.storage.sql.exec("SELECT data FROM queue ORDER BY sort_order ASC").toArray();
        return rows.map((r) => JSON.parse(r.data as string) as QueueItem);
    }

    private async broadcastQueue(): Promise<void> {
        const queue = this.getQueue();
        this.broadcast({ type: "queue-updated", queue });
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
                // Dead socket — cleaned up by webSocketClose
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
