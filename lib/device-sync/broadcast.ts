/**
 * BroadcastChannel wrapper — instant same-browser tab sync.
 *
 * Uses the same protocol as the WebSocket client. Provides zero-latency
 * communication between tabs in the same browser, with zero server cost.
 */

import type { ServerMessage, DeviceInfo } from "./protocol";
import { getDeviceId } from "./protocol";

const CHANNEL_NAME = "debridui-device-sync";

export class DeviceSyncBroadcast {
    private channel: BroadcastChannel | null = null;
    private onMessage: ((msg: ServerMessage) => void) | null = null;
    private deviceId: string;

    constructor() {
        this.deviceId = getDeviceId();
    }

    /** Start listening for messages from other tabs. */
    start(onMessage: (msg: ServerMessage) => void): void {
        if (typeof BroadcastChannel === "undefined") return;

        this.onMessage = onMessage;
        this.channel = new BroadcastChannel(CHANNEL_NAME);

        this.channel.onmessage = (event) => {
            const data = event.data;
            // Ignore messages from self
            if (data?._fromDeviceId === this.deviceId) return;
            if (data?.msg) {
                this.onMessage?.(data.msg as ServerMessage);
            }
        };
    }

    /** Stop listening and close the channel. */
    stop(): void {
        this.channel?.close();
        this.channel = null;
        this.onMessage = null;
    }

    /** Broadcast a message to all other tabs. */
    broadcast(msg: ServerMessage): void {
        if (!this.channel) return;
        try {
            this.channel.postMessage({ msg, _fromDeviceId: this.deviceId });
        } catch {
            // Channel closed or quota exceeded
        }
    }

    /** Broadcast a client-side event to other tabs as a server-style message. */
    broadcastNowPlaying(state: DeviceInfo["nowPlaying"]): void {
        this.broadcast({
            type: "now-playing-update",
            deviceId: this.deviceId,
            state,
        });
    }

    /** Broadcast a command received from WebSocket to other tabs too. */
    relayToTabs(msg: ServerMessage): void {
        this.broadcast(msg);
    }
}
