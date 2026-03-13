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

// Patch Next's ImageResponse shim so @vercel/og (and its WASM files) are never
// imported in Worker bundles. This project does not use ImageResponse/next/og.
const imageResponsePath = path.join(
        process.cwd(),
        "node_modules",
        "next",
        "dist",
        "server",
        "og",
        "image-response.js"
);

if (!fs.existsSync(imageResponsePath)) {
        console.log("[patch-next-node-env] Skipped image-response patch (file missing).");
        process.exit(0);
}

const imageResponseStub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "ImageResponse", {
    enumerable: true,
    get: function() {
        return ImageResponse;
    }
});
class ImageResponse extends Response {
    constructor() {
        throw new Error("ImageResponse is disabled in this deployment to keep Worker bundle size under Cloudflare free plan limits.");
    }
}
`;

const currentImageResponse = fs.readFileSync(imageResponsePath, "utf8");
if (currentImageResponse !== imageResponseStub) {
        fs.writeFileSync(imageResponsePath, imageResponseStub);
        console.log("[patch-next-node-env] Patched image-response to disable @vercel/og bundling.");
} else {
        console.log("[patch-next-node-env] image-response already patched.");
}

// Some Next build paths include next/dist/compiled/@vercel/og directly.
// Stub both edge/node compiled entrypoints so resvg.wasm/yoga.wasm cannot be
// pulled into the Worker bundle.
const compiledOgDir = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@vercel",
    "og"
);

const compiledOgStub = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ImageResponse extends Response {
  constructor() {
    throw new Error("@vercel/og is disabled in this deployment to keep Worker bundle size under Cloudflare free plan limits.");
  }
}
exports.ImageResponse = ImageResponse;
`;

for (const entry of ["index.edge.js", "index.node.js"]) {
    const entryPath = path.join(compiledOgDir, entry);
    if (!fs.existsSync(entryPath)) {
        console.log(`[patch-next-node-env] Skipped ${entry} patch (file missing).`);
        continue;
    }

    const current = fs.readFileSync(entryPath, "utf8");
    if (current !== compiledOgStub) {
        fs.writeFileSync(entryPath, compiledOgStub);
        console.log(`[patch-next-node-env] Patched ${entry} to disable @vercel/og compiled runtime.`);
    } else {
        console.log(`[patch-next-node-env] ${entry} already patched.`);
    }
}
