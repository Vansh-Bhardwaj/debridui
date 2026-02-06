const $ = (s) => document.querySelector(s);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function send(action, data = {}) {
  return chrome.runtime.sendMessage({ action, ...data });
}

function formatTime(seconds) {
  if (!seconds || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function toast(message, type = "success") {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "toast hidden"; }, 2000);
}

let currentStatus = null;

// ── Status Refresh ───────────────────────────────────────────────────────────

async function refreshStatus() {
  const dot = $("#status-dot");
  const label = $("#status-label");
  const player = $("#player-section");
  const disconnected = $("#disconnected-section");

  try {
    const res = await send("getStatus");
    if (res.success && res.data) {
      currentStatus = res.data;
      dot.className = "status-dot connected";
      label.textContent = "Connected";
      player.classList.remove("hidden");
      disconnected.classList.add("hidden");
      updatePlayer(res.data);
      return;
    }
  } catch {}

  // Not connected
  currentStatus = null;
  dot.className = "status-dot disconnected";
  label.textContent = "Offline";
  player.classList.add("hidden");
  disconnected.classList.remove("hidden");
}

function updatePlayer(s) {
  // Title
  const meta = s.information?.category?.meta;
  const title = meta?.filename || meta?.title || meta?.now_playing || "Unknown";
  $("#media-title").textContent = title;
  $("#media-title").title = title;

  // State
  const stateMap = { playing: "Playing", paused: "Paused", stopped: "Stopped" };
  $("#media-state").textContent = stateMap[s.state] || s.state;

  // Progress
  const pct = s.length > 0 ? (s.time / s.length) * 100 : 0;
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-thumb").style.left = `${pct}%`;
  $("#time-current").textContent = formatTime(s.time);
  $("#time-total").textContent = formatTime(s.length);

  // Play/Pause icon
  const isPlaying = s.state === "playing";
  $("#icon-play").classList.toggle("hidden", isPlaying);
  $("#icon-pause").classList.toggle("hidden", !isPlaying);

  // Volume
  const volPct = Math.round((s.volume / 256) * 100);
  $("#volume-slider").value = volPct;
  $("#volume-label").textContent = `${volPct}%`;

  // Audio/subtitle tracks
  updateTracks(s);
}

function updateTracks(s) {
  const info = s.information?.category;
  if (!info) return;

  const audioSelect = $("#select-audio");
  const subSelect = $("#select-sub");
  const currentAudioOpts = audioSelect.options.length;
  const currentSubOpts = subSelect.options.length;

  const audioTracks = [];
  const subTracks = [];

  for (const [key, val] of Object.entries(info)) {
    if (!val || key === "meta") continue;
    if (val.Type === "Audio") {
      audioTracks.push({ id: key.replace("Stream ", ""), name: val.Language || val.Description || key });
    } else if (val.Type === "Subtitle") {
      subTracks.push({ id: key.replace("Stream ", ""), name: val.Language || val.Description || key });
    }
  }

  // Only rebuild if the track count changed
  if (audioTracks.length + 1 !== currentAudioOpts) {
    audioSelect.innerHTML = '<option value="-1">Default</option>';
    for (const t of audioTracks) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      audioSelect.appendChild(opt);
    }
  }

  if (subTracks.length + 1 !== currentSubOpts) {
    subSelect.innerHTML = '<option value="-1">Disabled</option>';
    for (const t of subTracks) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      subSelect.appendChild(opt);
    }
  }
}

// ── Load & initial refresh ───────────────────────────────────────────────────

(async () => {
  refreshStatus();
})();

// ── Playback Controls ────────────────────────────────────────────────────────

$("#btn-play").addEventListener("click", () => send("togglePause"));
$("#btn-next").addEventListener("click", () => send("next"));
$("#btn-prev").addEventListener("click", () => send("previous"));

$("#btn-rw").addEventListener("click", () => {
  if (currentStatus) send("seek", { value: Math.max(0, currentStatus.time - 10) });
});
$("#btn-ff").addEventListener("click", () => {
  if (currentStatus) send("seek", { value: currentStatus.time + 10 });
});

// Seek by clicking progress bar
$("#progress-track").addEventListener("click", (e) => {
  if (!currentStatus || !currentStatus.length) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  send("seek", { value: Math.floor(pct * currentStatus.length) });
});

// Volume
$("#volume-slider").addEventListener("input", (e) => {
  const pct = e.target.value;
  const vlcVal = Math.round((pct / 100) * 256);
  send("setVolume", { value: vlcVal });
  $("#volume-label").textContent = `${pct}%`;
});

$("#btn-mute").addEventListener("click", () => {
  const slider = $("#volume-slider");
  if (parseInt(slider.value) > 0) {
    slider.dataset.prev = slider.value;
    slider.value = 0;
    send("setVolume", { value: 0 });
    $("#volume-label").textContent = "0%";
  } else {
    const prev = slider.dataset.prev || 100;
    slider.value = prev;
    send("setVolume", { value: Math.round((prev / 100) * 256) });
    $("#volume-label").textContent = `${prev}%`;
  }
});

// Track selection
$("#select-audio").addEventListener("change", (e) => {
  send("setAudioTrack", { id: parseInt(e.target.value) });
});

$("#select-sub").addEventListener("change", (e) => {
  send("setSubtitleTrack", { id: parseInt(e.target.value) });
});

// ── Actions ──────────────────────────────────────────────────────────────────

// Retry connection / setup guide
$("#btn-launch").addEventListener("click", async () => {
  const btn = $("#btn-launch");
  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" stroke-width="2" stroke-dasharray="20" stroke-dashoffset="0"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/></circle></svg> Connecting...';

  await refreshStatus();
  if (currentStatus) {
    toast("VLC connected!");
  } else {
    toast("VLC not reachable — follow the setup guide below", "info");
    const guide = $("#setup-guide");
    if (guide && !guide.open) guide.open = true;
  }

  setTimeout(() => {
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg> Retry Connection';
    btn.disabled = false;
  }, 1500);
});

// Play URL
$("#btn-play-url").addEventListener("click", async () => {
  const url = $("#input-url").value.trim();
  if (!url) { toast("Enter a URL first", "error"); return; }
  const res = await send("play", { url });
  if (res.success) {
    toast("Playing in VLC");
    $("#input-url").value = "";
    setTimeout(refreshStatus, 500);
  } else {
    toast(res.error || "Failed to play", "error");
  }
});

// Add subtitle URL
$("#btn-sub-url").addEventListener("click", async () => {
  const url = $("#input-url").value.trim();
  if (!url) { toast("Enter a subtitle URL first", "error"); return; }
  const res = await send("addSubtitle", { url });
  if (res.success) {
    toast("Subtitle loaded");
    $("#input-url").value = "";
  } else {
    toast(res.error || "Failed to load subtitle", "error");
  }
});

// Enter key in URL input
$("#input-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-play-url").click();
});

// ── Settings ─────────────────────────────────────────────────────────────────

$("#btn-save").addEventListener("click", async () => {
  const port = parseInt($("#input-port").value, 10);
  const password = $("#input-password").value;
  await send("setConfig", { port, password });
  toast("Settings saved");
  refreshStatus();
});

// Toggle password visibility
$("#btn-toggle-pw").addEventListener("click", () => {
  const pw = $("#input-password");
  pw.type = pw.type === "password" ? "text" : "password";
});

// ── Poll ─────────────────────────────────────────────────────────────────────

setInterval(refreshStatus, 2000);

// ── Setup Guide ──────────────────────────────────────────────────────────────

// Update setup command with saved password
(async () => {
  const res = await send("getConfig");
  const pw = res.success && res.data?.password ? res.data.password : "vlcbridge";
  const cmd = $("#setup-cmd");
  if (cmd) cmd.textContent = `vlc --extraintf http --http-password ${pw}`;
  // Pre-fill settings
  if (res.success) {
    $("#input-port").value = res.data.port || 8080;
    if (res.data.password) $("#input-password").value = res.data.password;
  }
})();

// Copy CLI command
const btnCopyCmd = $("#btn-copy-cmd");
if (btnCopyCmd) {
  btnCopyCmd.addEventListener("click", async () => {
    const text = $("#setup-cmd")?.textContent;
    if (text) {
      await navigator.clipboard.writeText(text).catch(() => {});
      toast("Command copied");
    }
  });
}
