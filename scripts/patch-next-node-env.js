const fs = require("fs");
const path = require("path");

const target = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "server",
    "node-environment.js"
);

if (!fs.existsSync(target)) {
    console.log("[patch-next-node-env] Skipped (next not installed yet).");
    process.exit(0);
}

let content = fs.readFileSync(target, "utf8");
let changed = false;

const patches = [
    {
        name: "console-file",
        pattern: /require\(["']\.\/node-environment-extensions\/console-file["']\);/g,
    },
    {
        name: "fast-set-immediate",
        pattern: /require\(["']\.\/node-environment-extensions\/fast-set-immediate\.external["']\);/g,
    },
];

for (const patch of patches) {
    if (patch.pattern.test(content)) {
        content = content.replace(patch.pattern, (match) => `// Removed for Cloudflare Workers: ${match}`);
        changed = true;
    }
}

if (changed) {
    fs.writeFileSync(target, content);
    console.log("[patch-next-node-env] Patched Next.js node environment.");
} else {
    console.log("[patch-next-node-env] No changes needed.");
}

// Patch fast-set-immediate to avoid importing node:fs (not available on Workers)
const fastSetImmediatePath = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "server",
    "node-environment-extensions",
    "fast-set-immediate.external.js"
);

if (!fs.existsSync(fastSetImmediatePath)) {
    console.log("[patch-next-node-env] Skipped fast-set-immediate patch (file missing).");
    process.exit(0);
}

let fastSetImmediate = fs.readFileSync(fastSetImmediatePath, "utf8");
const fsRequirePattern = /const\s+\{\s*writeFileSync\s*\}\s*=\s*require\(["']node:fs["']\);/g;

if (fsRequirePattern.test(fastSetImmediate)) {
    fastSetImmediate = fastSetImmediate.replace(
        fsRequirePattern,
        "const writeFileSync = () => {};"
    );
    fs.writeFileSync(fastSetImmediatePath, fastSetImmediate);
    console.log("[patch-next-node-env] Patched fast-set-immediate to remove node:fs.");
} else {
    console.log("[patch-next-node-env] fast-set-immediate already clean.");
}
