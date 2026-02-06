/**
 * Generate PNG icons from SVG for Chrome extension.
 * Run: node generate-icons.js
 */
const fs = require("fs");
const path = require("path");

function createIcon(size) {
  const { createCanvas } = (() => {
    try { return require("canvas"); } catch { return {}; }
  })();

  if (!createCanvas) {
    console.log(`  ⚠ 'canvas' not found — install with: npm i -D canvas`);
    return null;
  }

  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  const s = size / 128; // scale factor

  // Background
  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, 16 * s);
  ctx.fill();

  // Border
  ctx.strokeStyle = "rgba(221, 160, 50, 0.3)";
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.roundRect(8 * s, 8 * s, 112 * s, 112 * s, 12 * s);
  ctx.stroke();

  // D letter outline
  ctx.strokeStyle = "#dda032";
  ctx.lineWidth = 6 * s;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(36 * s, 28 * s);
  ctx.lineTo(56 * s, 28 * s);
  ctx.arc(56 * s, 56 * s, 28 * s, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(36 * s, 84 * s);
  ctx.closePath();
  ctx.stroke();

  // Play triangle
  ctx.fillStyle = "#dda032";
  ctx.beginPath();
  ctx.moveTo(58 * s, 44 * s);
  ctx.lineTo(80 * s, 56 * s);
  ctx.lineTo(58 * s, 68 * s);
  ctx.closePath();
  ctx.fill();

  // VLC text (only on larger sizes)
  if (size >= 48) {
    ctx.fillStyle = "rgba(221, 160, 50, 0.6)";
    ctx.font = `bold ${18 * s}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText("VLC", 64 * s, 112 * s);
  }

  return c.toBuffer("image/png");
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const out = path.join(__dirname, `icon${size}.png`);
  const buf = createIcon(size);
  if (buf) {
    fs.writeFileSync(out, buf);
    console.log(`✓ icon${size}.png (${size}x${size})`);
  }
}
