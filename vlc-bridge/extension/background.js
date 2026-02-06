// Debrid VLC Bridge — Service Worker
// Bridges web app ↔ VLC HTTP API.

const POLL_ALARM = "vlc-status-poll";

// ── State ──────────────────────────────────────────────────────────────────

let vlcConfig = { host: "127.0.0.1", port: 8080, password: "vlcbridge" };
let vlcConnected = false;
let lastStatus = null;
/** @type {Map<string, chrome.runtime.Port>} */
const activePorts = new Map();

// ── Init ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["vlcConfig"]);
  if (stored.vlcConfig) {
    vlcConfig = { ...vlcConfig, ...stored.vlcConfig };
  } else {
    // Save defaults on first install so password is pre-configured
    await chrome.storage.local.set({ vlcConfig });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(["vlcConfig"]);
  if (stored.vlcConfig) vlcConfig = { ...vlcConfig, ...stored.vlcConfig };
});

// ── VLC HTTP API ───────────────────────────────────────────────────────────

async function vlcFetch(path, params = {}) {
  const url = new URL(`http://${vlcConfig.host}:${vlcConfig.port}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  const headers = {};
  if (vlcConfig.password) {
    headers["Authorization"] =
      "Basic " + btoa(`:${vlcConfig.password}`);
  }
  const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`VLC HTTP ${res.status}`);
  return res;
}

async function vlcCommand(command, params = {}) {
  const res = await vlcFetch("/requests/status.json", { command, ...params });
  return res.json();
}

async function vlcStatus() {
  const res = await vlcFetch("/requests/status.json");
  return res.json();
}

async function vlcPlaylist() {
  const res = await vlcFetch("/requests/playlist.json");
  return res.json();
}

// ── Command Handlers ───────────────────────────────────────────────────────

/** Fetch subtitle content and save to a temp file, then load in VLC.
 *  Uses chrome.downloads with immediate erase so nothing lingers in the UI. */
async function addSubtitleViaFetch(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "DebridUI/1.0", accept: "text/plain, text/vtt, application/x-subrip, */*" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Subtitle fetch failed: ${response.status}`);

  const text = await response.text();
  // Encode as base64 data URI for chrome.downloads
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);
  const ext = url.includes(".vtt") ? "vtt" : "srt";
  const dataUri = `data:application/octet-stream;base64,${base64}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUri, filename: `vlc-bridge-subs/sub-${Date.now()}.${ext}`, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        const listener = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === "complete") {
            chrome.downloads.onChanged.removeListener(listener);
            chrome.downloads.search({ id: downloadId }, async (results) => {
              if (results.length > 0) {
                const filePath = results[0].filename.replace(/\\/g, "/");
                // Erase from Chrome's download list immediately
                chrome.downloads.erase({ id: downloadId });
                try {
                  const result = await vlcCommand("addsubtitle", { val: filePath });
                  // Clean up temp file after VLC reads it
                  setTimeout(() => chrome.downloads.removeFile(downloadId), 5000);
                  resolve(result);
                } catch (err) {
                  reject(err);
                }
              } else {
                reject(new Error("Download completed but file not found"));
              }
            });
          } else if (delta.state?.current === "interrupted") {
            chrome.downloads.onChanged.removeListener(listener);
            reject(new Error("Subtitle download failed"));
          }
        };
        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

const handlers = {
  async ping() {
    try {
      await vlcStatus();
      vlcConnected = true;
      return { connected: true };
    } catch {
      vlcConnected = false;
      return { connected: false };
    }
  },

  async getStatus() {
    const status = await vlcStatus();
    vlcConnected = true;
    lastStatus = status;
    return status;
  },

  async getPlaylist() {
    return vlcPlaylist();
  },

  async play({ url, options, subtitles }) {
    const params = { input: url };
    const opts = [];
    if (options?.noaudio) opts.push("noaudio");
    if (options?.novideo) opts.push("novideo");
    // Load subtitles as input-slave (VLC auto-detects format from content)
    if (subtitles?.length) {
      opts.push(`:input-slave=${subtitles.join("#")}`);
    }
    if (opts.length) params.option = opts.length === 1 ? opts[0] : opts;
    return vlcCommand("in_play", params);
  },

  async enqueue({ url }) {
    return vlcCommand("in_enqueue", { input: url });
  },

  async addSubtitle({ url }) {
    // For HTTP URLs: first try passing URL directly to VLC.
    // If that fails, fetch the content in the service worker and save to temp file.
    if (url.startsWith("http://") || url.startsWith("https://")) {
      try {
        // Try URL directly — works if VLC can fetch from it
        const result = await vlcCommand("addsubtitle", { val: url });
        return result;
      } catch {
        // VLC couldn't fetch the URL — download content ourselves
        return addSubtitleViaFetch(url);
      }
    }
    return vlcCommand("addsubtitle", { val: url.replace(/\\/g, "/") });
  },

  async pause() {
    return vlcCommand("pl_forcepause");
  },

  async resume() {
    return vlcCommand("pl_forceresume");
  },

  async togglePause() {
    return vlcCommand("pl_pause");
  },

  async stop() {
    return vlcCommand("pl_stop");
  },

  async next() {
    return vlcCommand("pl_next");
  },

  async previous() {
    return vlcCommand("pl_previous");
  },

  async seek({ value }) {
    return vlcCommand("seek", { val: value });
  },

  async setVolume({ value }) {
    return vlcCommand("volume", { val: value });
  },

  async fullscreen() {
    return vlcCommand("fullscreen");
  },

  async setAudioTrack({ id }) {
    return vlcCommand("audio_track", { val: id });
  },

  async setSubtitleTrack({ id }) {
    return vlcCommand("subtitle_track", { val: id });
  },

  async setVideoTrack({ id }) {
    return vlcCommand("video_track", { val: id });
  },

  async setSubtitleDelay({ seconds }) {
    return vlcCommand("subdelay", { val: seconds });
  },

  async setAudioDelay({ seconds }) {
    return vlcCommand("audiodelay", { val: seconds });
  },

  async setPlaybackRate({ rate }) {
    return vlcCommand("rate", { val: rate });
  },

  async setLoop() {
    return vlcCommand("pl_loop");
  },

  async setRepeat() {
    return vlcCommand("pl_repeat");
  },

  async setRandom() {
    return vlcCommand("pl_random");
  },

  async emptyPlaylist() {
    return vlcCommand("pl_empty");
  },

  async deleteFromPlaylist({ id }) {
    return vlcCommand("pl_delete", { id });
  },

  async playFromPlaylist({ id }) {
    return vlcCommand("pl_play", { id });
  },

  async setAspectRatio({ ratio }) {
    return vlcCommand("aspectratio", { val: ratio });
  },

  // ── Config ──

  async getConfig() {
    return { ...vlcConfig, connected: vlcConnected };
  },

  async setConfig({ host, port, password }) {
    if (host !== undefined) vlcConfig.host = host;
    if (port !== undefined) vlcConfig.port = port;
    if (password !== undefined) vlcConfig.password = password;
    await chrome.storage.local.set({ vlcConfig });
    return { success: true };
  },

  // ── Polling control ──

  async startPolling() {
    // Chrome enforces 30s minimum for alarms; use 0.5min
    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
    return { polling: true };
  },

  async stopPolling() {
    await chrome.alarms.clear(POLL_ALARM);
    return { polling: false };
  },
};

// ── Message Router ─────────────────────────────────────────────────────────

async function handleMessage(message) {
  const { action, ...data } = message;
  const handler = handlers[action];
  if (!handler) return { success: false, error: `Unknown action: ${action}` };

  try {
    const result = await handler(data);
    return { success: true, data: result };
  } catch (err) {
    vlcConnected = false;
    const code = err.code
      || (err.message.includes("NetworkError") || err.message.includes("Failed to fetch")
        ? "VLC_NOT_RUNNING"
        : "COMMAND_FAILED");
    return {
      success: false,
      error: err.message,
      code,
      ...(err.command ? { command: err.command } : {}),
    };
  }
}

// External messages (from web app via externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // async response
});

// Internal messages (from popup or content scripts)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;
});

// ── Long-lived Port Connections ────────────────────────────────────────────
// Web apps can use chrome.runtime.connect(extId) for push-based status updates.

chrome.runtime.onConnectExternal.addListener(handlePort);
chrome.runtime.onConnect.addListener(handlePort);

function handlePort(port) {
  const id = `${port.sender?.tab?.id || "popup"}-${Date.now()}`;
  activePorts.set(id, port);

  // Start polling when first port connects
  if (activePorts.size === 1) startStatusPolling();

  port.onMessage.addListener(async (message) => {
    const response = await handleMessage(message);
    try { port.postMessage(response); } catch {}
  });

  port.onDisconnect.addListener(() => {
    activePorts.delete(id);
    if (activePorts.size === 0) stopStatusPolling();
  });
}

function broadcastStatus(status) {
  const message = { type: "status", data: status };
  for (const [id, port] of activePorts) {
    try { port.postMessage(message); } catch { activePorts.delete(id); }
  }
}

// ── Status Polling via Alarms ──────────────────────────────────────────────

async function startStatusPolling() {
  // Chrome 120+ supports 30s minimum alarm interval
  await chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  // Do an immediate poll
  pollVLCStatus();
}

async function stopStatusPolling() {
  await chrome.alarms.clear(POLL_ALARM);
}

async function pollVLCStatus() {
  try {
    const status = await vlcStatus();
    vlcConnected = true;
    lastStatus = status;
    broadcastStatus(status);

    // Auto-detect end of playback for auto-next
    if (status.state === "stopped" && lastStatus?.state === "playing") {
      broadcastStatus({ type: "playback-ended", data: status });
    }
  } catch {
    if (vlcConnected) {
      vlcConnected = false;
      broadcastStatus({ type: "disconnected" });
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollVLCStatus();
});
