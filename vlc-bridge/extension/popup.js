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
let subDelay = 0;
let audioDelay = 0;
let loopActive = false;
let shuffleActive = false;

// Smooth progress interpolation
let progressAnimFrame = null;
let interpStart = null;
let interpStartTime = 0;
let interpRate = 1;

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
      // Start smooth progress animation when playing
      if (res.data.state === "playing") startProgressAnimation();
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

  // Progress — store for interpolation
  interpStart = s.time;
  interpStartTime = performance.now();
  interpRate = s.state === "playing" ? (s.rate || 1) : 0;

  // Update progress display
  const pct = s.length > 0 ? (s.time / s.length) * 100 : 0;
  setProgressUI(pct, s.time, s.length);

  // Play/Pause icon
  const isPlaying = s.state === "playing";
  $("#icon-play").classList.toggle("hidden", isPlaying);
  $("#icon-pause").classList.toggle("hidden", !isPlaying);

  // Volume
  const volPct = Math.round((s.volume / 256) * 100);
  $("#volume-slider").value = volPct;
  updateVolumeSliderFill(volPct);
  $("#volume-label").textContent = `${volPct}%`;

  // Playback speed
  if (s.rate !== undefined) {
    const rate = parseFloat(s.rate);
    const speedSelect = $("#select-speed");
    const closest = [...speedSelect.options].reduce((prev, opt) =>
      Math.abs(parseFloat(opt.value) - rate) < Math.abs(parseFloat(prev.value) - rate) ? opt : prev
    );
    speedSelect.value = closest.value;
  }

  // Loop / Random state
  if (s.loop !== undefined) {
    loopActive = s.loop;
    $("#btn-loop").classList.toggle("active", loopActive);
  }
  if (s.random !== undefined) {
    shuffleActive = s.random;
    $("#btn-shuffle").classList.toggle("active", shuffleActive);
  }

  // VLC art
  updateArt();

  // Stream quality badge
  updateQualityBadge(s);

  // Audio/subtitle tracks
  updateTracks(s);
}

// ── Progress helpers ─────────────────────────────────────────────────────────

function setProgressUI(pct, time, total) {
  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-thumb").style.left = `${pct}%`;
  $("#time-current").textContent = formatTime(time);
  $("#time-total").textContent = formatTime(total);
}

function animateProgress() {
  if (!currentStatus || currentStatus.state !== "playing" || !currentStatus.length) {
    progressAnimFrame = null;
    return;
  }
  const elapsed = (performance.now() - interpStartTime) / 1000;
  const interpolated = (interpStart || 0) + elapsed * interpRate;
  const clamped = Math.min(interpolated, currentStatus.length);
  const pct = (clamped / currentStatus.length) * 100;
  setProgressUI(pct, clamped, currentStatus.length);
  progressAnimFrame = requestAnimationFrame(animateProgress);
}

function startProgressAnimation() {
  if (progressAnimFrame) cancelAnimationFrame(progressAnimFrame);
  progressAnimFrame = requestAnimationFrame(animateProgress);
}

// ── VLC Art ──────────────────────────────────────────────────────────────────

let lastArtUrl = "";

async function updateArt() {
  try {
    const res = await send("getArt");
    if (res.success && res.data) {
      const artUrl = res.data;
      if (artUrl !== lastArtUrl) {
        lastArtUrl = artUrl;
        const img = $("#np-art-img");
        img.src = artUrl;
        img.onload = () => img.classList.remove("hidden");
        img.onerror = () => { img.classList.add("hidden"); lastArtUrl = ""; };
      }
    } else {
      $("#np-art-img").classList.add("hidden");
      lastArtUrl = "";
    }
  } catch {
    $("#np-art-img").classList.add("hidden");
    lastArtUrl = "";
  }
}

// ── Stream Quality Badge ─────────────────────────────────────────────────────

function updateQualityBadge(s) {
  const info = s.information?.category;
  if (!info) return;

  const parts = [];

  // Find video stream for resolution
  for (const [key, val] of Object.entries(info)) {
    if (!val || key === "meta" || val.Type !== "Video") continue;
    // Resolution from Display_resolution or Decoded_format
    const res = val.Display_resolution || val.Decoded_format || "";
    const match = res.match(/(\d{3,4})x(\d{3,4})/);
    if (match) {
      const h = parseInt(match[2]);
      if (h >= 2160) parts.push("4K");
      else if (h >= 1440) parts.push("1440p");
      else if (h >= 1080) parts.push("1080p");
      else if (h >= 720) parts.push("720p");
      else parts.push(`${h}p`);
    }
    break;
  }

  // Find audio stream for codec + channels
  for (const [key, val] of Object.entries(info)) {
    if (!val || key === "meta" || val.Type !== "Audio") continue;
    const codec = val.Codec || "";
    const shortCodec = parseCodecShort(codec);
    if (shortCodec) parts.push(shortCodec);
    const channels = val.Channels;
    if (channels) parts.push(channels);
    break;
  }

  const badge = $("#media-quality");
  if (parts.length > 0) {
    badge.textContent = parts.join(" · ");
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function parseCodecShort(codec) {
  if (/a52|ac-?3/i.test(codec)) return "AC3";
  if (/e-?ac-?3|eac3/i.test(codec)) return "EAC3";
  if (/dts/i.test(codec)) return "DTS";
  if (/aac|mp4a/i.test(codec)) return "AAC";
  if (/opus/i.test(codec)) return "Opus";
  if (/flac/i.test(codec)) return "FLAC";
  if (/truehd/i.test(codec)) return "TrueHD";
  if (/h264|avc/i.test(codec)) return "H.264";
  if (/h265|hevc/i.test(codec)) return "HEVC";
  if (/vp9/i.test(codec)) return "VP9";
  if (/av01|av1/i.test(codec)) return "AV1";
  return null;
}

// ── Volume Slider Fill ───────────────────────────────────────────────────────

function updateVolumeSliderFill(pct) {
  const slider = $("#volume-slider");
  slider.style.background = `linear-gradient(to right, #dda032 ${pct}%, var(--muted) ${pct}%)`;
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

// ── Collapsible Panel Toggle ─────────────────────────────────────────────────

$("#panel-toggle").addEventListener("click", () => {
  const btn = $("#panel-toggle");
  const panel = $("#panel-content");
  btn.classList.toggle("expanded");
  panel.classList.toggle("visible");
});

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
  updateVolumeSliderFill(parseInt(pct));
  $("#volume-label").textContent = `${pct}%`;
});

$("#btn-mute").addEventListener("click", () => {
  const slider = $("#volume-slider");
  if (parseInt(slider.value) > 0) {
    slider.dataset.prev = slider.value;
    slider.value = 0;
    send("setVolume", { value: 0 });
    updateVolumeSliderFill(0);
    $("#volume-label").textContent = "0%";
  } else {
    const prev = slider.dataset.prev || 100;
    slider.value = prev;
    send("setVolume", { value: Math.round((prev / 100) * 256) });
    updateVolumeSliderFill(parseInt(prev));
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

// Playback speed
$("#select-speed").addEventListener("change", (e) => {
  send("setPlaybackRate", { rate: parseFloat(e.target.value) });
});

// Fullscreen
$("#btn-fullscreen").addEventListener("click", () => send("fullscreen"));

// Subtitle delay (Shift = ±0.1s, default = ±0.5s)
$("#btn-sub-delay-minus").addEventListener("click", (e) => {
  const step = e.shiftKey ? 0.1 : 0.5;
  subDelay = Math.round((subDelay - step) * 10) / 10;
  send("setSubtitleDelay", { seconds: subDelay });
  $("#sub-delay-value").textContent = `${subDelay.toFixed(1)}s`;
});
$("#btn-sub-delay-plus").addEventListener("click", (e) => {
  const step = e.shiftKey ? 0.1 : 0.5;
  subDelay = Math.round((subDelay + step) * 10) / 10;
  send("setSubtitleDelay", { seconds: subDelay });
  $("#sub-delay-value").textContent = `${subDelay.toFixed(1)}s`;
});
$("#btn-sub-delay-reset").addEventListener("click", () => {
  subDelay = 0;
  send("setSubtitleDelay", { seconds: 0 });
  $("#sub-delay-value").textContent = "0.0s";
});

// Audio delay (Shift = ±0.1s, default = ±0.5s)
$("#btn-audio-delay-minus").addEventListener("click", (e) => {
  const step = e.shiftKey ? 0.1 : 0.5;
  audioDelay = Math.round((audioDelay - step) * 10) / 10;
  send("setAudioDelay", { seconds: audioDelay });
  $("#audio-delay-value").textContent = `${audioDelay.toFixed(1)}s`;
});
$("#btn-audio-delay-plus").addEventListener("click", (e) => {
  const step = e.shiftKey ? 0.1 : 0.5;
  audioDelay = Math.round((audioDelay + step) * 10) / 10;
  send("setAudioDelay", { seconds: audioDelay });
  $("#audio-delay-value").textContent = `${audioDelay.toFixed(1)}s`;
});
$("#btn-audio-delay-reset").addEventListener("click", () => {
  audioDelay = 0;
  send("setAudioDelay", { seconds: 0 });
  $("#audio-delay-value").textContent = "0.0s";
});

// Loop / Shuffle toggles
$("#btn-loop").addEventListener("click", () => {
  send("setLoop");
  loopActive = !loopActive;
  $("#btn-loop").classList.toggle("active", loopActive);
});

$("#btn-shuffle").addEventListener("click", () => {
  send("setRandom");
  shuffleActive = !shuffleActive;
  $("#btn-shuffle").classList.toggle("active", shuffleActive);
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
// ── Keyboard Shortcuts ───────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Skip if focused on an input/select
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      send("togglePause");
      break;
    case "ArrowLeft":
      e.preventDefault();
      if (currentStatus) send("seek", { value: Math.max(0, currentStatus.time - 10) });
      break;
    case "ArrowRight":
      e.preventDefault();
      if (currentStatus) send("seek", { value: currentStatus.time + 10 });
      break;
    case "ArrowUp":
      e.preventDefault();
      { const cur = parseInt($("#volume-slider").value);
        const next = Math.min(200, cur + 5);
        $("#volume-slider").value = next;
        send("setVolume", { value: Math.round((next / 100) * 256) });
        updateVolumeSliderFill(next);
        $("#volume-label").textContent = `${next}%`;
      }
      break;
    case "ArrowDown":
      e.preventDefault();
      { const cur = parseInt($("#volume-slider").value);
        const next = Math.max(0, cur - 5);
        $("#volume-slider").value = next;
        send("setVolume", { value: Math.round((next / 100) * 256) });
        updateVolumeSliderFill(next);
        $("#volume-label").textContent = `${next}%`;
      }
      break;
    case "m":
    case "M":
      e.preventDefault();
      $("#btn-mute").click();
      break;
    case "f":
    case "F":
      e.preventDefault();
      send("fullscreen");
      break;
  }
});
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
