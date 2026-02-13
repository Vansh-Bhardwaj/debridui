/**
 * DeviceSyncClient — WebSocket client with auto-reconnect for the device sync worker.
 *
 * Handles connection lifecycle, token refresh, and message routing.
 * Uses exponential backoff on disconnection (1s → 2s → 4s → 30s cap).
 */

import type { ClientMessage, ServerMessage, DeviceInfo, RemoteAction, TransferPayload } from "./protocol";
import { detectDevice } from "./protocol";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface DeviceSyncClientOptions {
    /** Sync worker WebSocket URL (e.g. wss://debridui-sync.xxx.workers.dev/ws) */
    syncUrl: string;
    /** Function to fetch a fresh auth token */
    getToken: () => Promise<string | null>;
    /** Called when a message arrives from the DO */
    onMessage: (msg: ServerMessage) => void;
    /** Called when connection status changes */
    onStatusChange?: (status: ConnectionStatus) => void;
}

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;
const RECONNECT_MULTIPLIER = 2;

export class DeviceSyncClient {
    private ws: WebSocket | null = null;
    private options: DeviceSyncClientOptions;
    private reconnectDelay = MIN_RECONNECT_MS;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private intentionalClose = false;
    private device = detectDevice();
    private _status: ConnectionStatus = "disconnected";

    constructor(options: DeviceSyncClientOptions) {
        this.options = options;
    }

    get status(): ConnectionStatus {
        return this._status;
    }

    get deviceId(): string {
        return this.device.id;
    }

    /** Connect to the sync worker. Idempotent — safe to call multiple times. */
    async connect(): Promise<void> {
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.intentionalClose = false;
        this.setStatus("connecting");

        const token = await this.options.getToken();
        if (!token) {
            this.setStatus("disconnected");
            return;
        }

        const url = new URL("/ws", this.options.syncUrl);
        url.searchParams.set("token", token);
        url.searchParams.set("deviceId", this.device.id);

        try {
            this.ws = new WebSocket(url.toString());

            this.ws.onopen = () => {
                this.reconnectDelay = MIN_RECONNECT_MS;
                this.setStatus("connected");

                // Register this device
                this.send({
                    type: "register",
                    device: this.device,
                });
            };

            this.ws.onmessage = (event) => {
                if (typeof event.data !== "string") return;
                try {
                    const msg = JSON.parse(event.data) as ServerMessage;
                    this.options.onMessage(msg);
                } catch {
                    // Invalid message — ignore
                }
            };

            this.ws.onclose = () => {
                this.ws = null;
                this.setStatus("disconnected");

                if (!this.intentionalClose) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = () => {
                // onclose will fire after onerror, so reconnect happens there
            };
        } catch {
            this.setStatus("disconnected");
            this.scheduleReconnect();
        }
    }

    /** Gracefully disconnect. No auto-reconnect. */
    disconnect(): void {
        this.intentionalClose = true;
        this.clearReconnectTimer();

        if (this.ws) {
            this.ws.close(1000, "User disconnect");
            this.ws = null;
        }

        this.setStatus("disconnected");
    }

    /** Send a message to the DO. Returns false if not connected. */
    send(msg: ClientMessage): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        try {
            this.ws.send(JSON.stringify(msg));
            return true;
        } catch {
            return false;
        }
    }

    /** Send now-playing state update. */
    reportNowPlaying(state: DeviceInfo["nowPlaying"]): void {
        this.send({ type: "now-playing", state });
    }

    /** Send a remote command to another device. */
    sendCommand(targetDeviceId: string, action: RemoteAction, payload?: Record<string, unknown>): void {
        this.send({
            type: "command",
            target: targetDeviceId,
            action,
            payload,
        });
    }

    /** Transfer playback to another device. */
    transferTo(targetDeviceId: string, playback: TransferPayload): void {
        this.send({
            type: "transfer",
            target: targetDeviceId,
            playback,
        });
    }

    // ── Internal ───────────────────────────────────────────────────────

    private setStatus(status: ConnectionStatus): void {
        if (this._status === status) return;
        this._status = status;
        this.options.onStatusChange?.(status);
    }

    private scheduleReconnect(): void {
        this.clearReconnectTimer();

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, this.reconnectDelay);

        // Exponential backoff with cap
        this.reconnectDelay = Math.min(
            this.reconnectDelay * RECONNECT_MULTIPLIER,
            MAX_RECONNECT_MS
        );
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
}
