/**
 * VLC Bridge client — communicates with the Debrid VLC Bridge extension.
 *
 * Supports two transports:
 * 1. Direct (externally_connectable) — requires extension ID
 * 2. Content script bridge (CustomEvent) — works automatically
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const chrome: any;

// ── Types ──────────────────────────────────────────────────────────────────

export interface VLCStatus {
  state: "playing" | "paused" | "stopped";
  time: number;
  length: number;
  position: number; // 0-1
  volume: number; // 0-512 (256 = 100%)
  fullscreen: boolean;
  loop: boolean;
  repeat: boolean;
  random: boolean;
  rate: number;
  audiodelay: number;
  subtitledelay: number;
  information?: {
    category?: {
      meta?: Record<string, string>;
      [streamKey: string]: {
        Type?: string;
        Language?: string;
        Codec?: string;
        [key: string]: string | undefined;
      } | undefined;
    };
  };
}

export interface VLCPlaylistEntry {
  id: number;
  name: string;
  uri: string;
  duration: number;
  current?: string;
}

export interface BridgeResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: "VLC_NOT_RUNNING" | "COMMAND_FAILED" | "EXTENSION_ERROR" | "NO_NATIVE_HOST";
  command?: string;
}

export interface PlayOptions {
  noaudio?: boolean;
  novideo?: boolean;
  subtitles?: string[];
}

type StatusHandler = (status: VLCStatus) => void;
type DisconnectHandler = () => void;

// ── Client ─────────────────────────────────────────────────────────────────

export class VLCBridgeClient {
  private extensionId: string | null;
  private transport: "direct" | "content-script" | null = null;
  private pendingRequests = new Map<string, (res: BridgeResponse) => void>();
  private statusListeners = new Set<StatusHandler>();
  private disconnectListeners = new Set<DisconnectHandler>();
  private requestId = 0;

  constructor(extensionId?: string) {
    this.extensionId = extensionId ?? null;
  }

  // ── Connection ─────────────────────────────────────────────────────────

  /** Detect which transport is available.
   *  Prefers content-script (no extension ID needed) over direct. */
  async detect(): Promise<boolean> {
    // Try content script bridge first (works without extension ID)
    if (await this.hasContentScript()) {
      this.transport = "content-script";
      this.setupContentScriptListeners();
      return true;
    }
    // Fallback to direct (requires extension ID)
    if (this.extensionId && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        const res = await this.sendDirect({ action: "ping" });
        if (res.success) {
          this.transport = "direct";
          return true;
        }
      } catch {}
    }
    return false;
  }

  get isAvailable() {
    return this.transport !== null;
  }

  private hasContentScript(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const handler = () => {
        if (!resolved) { resolved = true; resolve(true); }
      };
      window.addEventListener("vlc-bridge-available", handler, { once: true });
      // The content script may have already fired this event
      // Try sending a test message
      const testId = `detect-${Date.now()}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("vlc-bridge-available", handler);
        if (!resolved) { resolved = true; resolve(false); }
      }, 200);
      const respHandler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?._reqId === testId) {
          window.removeEventListener("vlc-bridge-response", respHandler);
          clearTimeout(timeout);
          if (!resolved) { resolved = true; resolve(true); }
        }
      };
      window.addEventListener("vlc-bridge-response", respHandler);
      window.dispatchEvent(
        new CustomEvent("vlc-bridge-request", { detail: { _reqId: testId, action: "ping" } })
      );
    });
  }

  private setupContentScriptListeners() {
    window.addEventListener("vlc-bridge-response", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const cb = this.pendingRequests.get(detail?._reqId);
      if (cb) {
        this.pendingRequests.delete(detail._reqId);
        cb(detail);
      }
    });
    window.addEventListener("vlc-bridge-push", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "status" && detail.data) {
        for (const fn of this.statusListeners) fn(detail.data);
      }
      if (detail?.type === "disconnected") {
        for (const fn of this.disconnectListeners) fn();
      }
    });
  }

  // ── Message sending ────────────────────────────────────────────────────

  private sendDirect(message: Record<string, unknown>): Promise<BridgeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.extensionId) return reject(new Error("No extension ID"));
      chrome.runtime.sendMessage(this.extensionId, message, (response: BridgeResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  private sendViaContentScript(message: Record<string, unknown>): Promise<BridgeResponse> {
    return new Promise((resolve) => {
      const reqId = `req-${++this.requestId}`;
      this.pendingRequests.set(reqId, resolve);
      window.dispatchEvent(
        new CustomEvent("vlc-bridge-request", { detail: { _reqId: reqId, ...message } })
      );
      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          resolve({ success: false, error: "Timeout", code: "EXTENSION_ERROR" });
        }
      }, 5000);
    });
  }

  private async send(message: Record<string, unknown>): Promise<BridgeResponse> {
    if (this.transport === "direct") return this.sendDirect(message);
    if (this.transport === "content-script") return this.sendViaContentScript(message);
    throw new Error("VLC Bridge not connected. Call detect() first.");
  }

  // ── Push status (connect a long-lived port for live updates) ───────────

  startStatusUpdates() {
    if (this.transport === "content-script") {
      window.dispatchEvent(new CustomEvent("vlc-bridge-connect"));
    }
    // For direct transport, would need chrome.runtime.connect — not available from page context
    // The web app should poll via getStatus() instead
  }

  stopStatusUpdates() {
    if (this.transport === "content-script") {
      window.dispatchEvent(new CustomEvent("vlc-bridge-disconnect"));
    }
  }

  onStatus(handler: StatusHandler) {
    this.statusListeners.add(handler);
    return () => { this.statusListeners.delete(handler); };
  }

  onDisconnect(handler: DisconnectHandler) {
    this.disconnectListeners.add(handler);
    return () => { this.disconnectListeners.delete(handler); };
  }

  // ── API Methods ────────────────────────────────────────────────────────

  ping() {
    return this.send({ action: "ping" });
  }

  getStatus() {
    return this.send({ action: "getStatus" }) as Promise<BridgeResponse<VLCStatus>>;
  }

  getPlaylist() {
    return this.send({ action: "getPlaylist" });
  }

  play(url: string, options?: PlayOptions & { subtitles?: string[] }) {
    const { subtitles, ...rest } = options ?? {};
    return this.send({ action: "play", url, options: Object.keys(rest).length ? rest : undefined, subtitles });
  }

  enqueue(url: string) {
    return this.send({ action: "enqueue", url });
  }

  addSubtitle(url: string) {
    return this.send({ action: "addSubtitle", url });
  }

  pause() {
    return this.send({ action: "pause" });
  }

  resume() {
    return this.send({ action: "resume" });
  }

  togglePause() {
    return this.send({ action: "togglePause" });
  }

  stop() {
    return this.send({ action: "stop" });
  }

  next() {
    return this.send({ action: "next" });
  }

  previous() {
    return this.send({ action: "previous" });
  }

  seek(value: number | string) {
    return this.send({ action: "seek", value });
  }

  setVolume(value: number | string) {
    return this.send({ action: "setVolume", value });
  }

  fullscreen() {
    return this.send({ action: "fullscreen" });
  }

  setAudioTrack(id: number) {
    return this.send({ action: "setAudioTrack", id });
  }

  setSubtitleTrack(id: number) {
    return this.send({ action: "setSubtitleTrack", id });
  }

  setSubtitleDelay(seconds: number) {
    return this.send({ action: "setSubtitleDelay", seconds });
  }

  setAudioDelay(seconds: number) {
    return this.send({ action: "setAudioDelay", seconds });
  }

  setPlaybackRate(rate: number) {
    return this.send({ action: "setPlaybackRate", rate });
  }

  emptyPlaylist() {
    return this.send({ action: "emptyPlaylist" });
  }

  playFromPlaylist(id: number) {
    return this.send({ action: "playFromPlaylist", id });
  }
}
