/**
 * Build script — packages the extension into a zip for Chrome Web Store upload.
 * Run: node build-zip.js
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const EXT_DIR = path.join(__dirname, "extension");
const OUT_DIR = __dirname;

// Read version from manifest
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf-8"));
const version = manifest.version;
const zipName = `debrid-vlc-bridge-v${version}.zip`;
const zipPath = path.join(OUT_DIR, zipName);

// Remove old zip if exists
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

// Files to include (no dev-only files)
const include = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// Verify all files exist
for (const file of include) {
  const full = path.join(EXT_DIR, file);
  if (!fs.existsSync(full)) {
    console.error(`Missing: ${file}`);
    process.exit(1);
  }
}

// Use PowerShell Compress-Archive on Windows, zip on Unix
const isWindows = process.platform === "win32";

if (isWindows) {
  // Create a temp directory with only the files we need
  const tmp = path.join(OUT_DIR, "_build_tmp");
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  fs.mkdirSync(tmp);
  fs.mkdirSync(path.join(tmp, "icons"), { recursive: true });

  for (const file of include) {
    fs.copyFileSync(path.join(EXT_DIR, file), path.join(tmp, file));
  }

  execSync(
    `powershell -Command "Compress-Archive -Path '${tmp}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "inherit" }
  );

  fs.rmSync(tmp, { recursive: true });
} else {
  const files = include.map((f) => `"${f}"`).join(" ");
  execSync(`cd "${EXT_DIR}" && zip -j "${zipPath}" ${files}`, { stdio: "inherit" });
}

const size = fs.statSync(zipPath).size;
console.log(`\n✓ ${zipName} (${(size / 1024).toFixed(1)} KB)`);
console.log(`  Ready for upload at: https://chrome.google.com/webstore/devconsole`);
