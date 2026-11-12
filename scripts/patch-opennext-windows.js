// OpenNext's Turbopack plugin matches traced server chunks with POSIX paths
// (".next/server/chunks/"). On Windows the traced paths use backslashes, so no
// chunk is inlined, `requireChunk` has an empty switch, and every server route
// fails at runtime with "ComponentMod.handler is not a function".
// Normalize the paths so `opennextjs-cloudflare build` works from Windows.
const fs = require("fs");
const path = require("path");

const target = path.join(
    process.cwd(),
    "node_modules",
    "@opennextjs",
    "cloudflare",
    "dist",
    "cli",
    "build",
    "patches",
    "plugins",
    "turbopack.js"
);

if (!fs.existsSync(target)) {
    console.log("[patch-opennext-windows] Skipped (@opennextjs/cloudflare not installed).");
    process.exit(0);
}

const original = `        if (file.includes(".next/server/chunks/")) {
            chunks.add(file);
        }`;
const patched = `        const normalized = file.replaceAll("\\\\", "/");
        if (normalized.includes(".next/server/chunks/")) {
            chunks.add(normalized);
        }`;

const content = fs.readFileSync(target, "utf8");
if (content.includes(patched)) {
    console.log("[patch-opennext-windows] Already patched.");
} else if (content.includes(original)) {
    fs.writeFileSync(target, content.replace(original, patched));
    console.log("[patch-opennext-windows] Patched turbopack chunk paths.");
} else {
    // Upstream changed: fail loudly so a broken Windows build isn't deployed silently.
    console.warn("[patch-opennext-windows] Pattern not found — check OpenNext turbopack.js on Windows builds.");
}
