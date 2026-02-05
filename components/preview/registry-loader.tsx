"use client";

import "@/lib/preview/register-renderers";

/**
 * Component that just imports the preview renderers side-effect.
 * This is used to lazily load the heavy preview components (Video.js, etc.)
 * only in layouts that actually need them aka the main app layout.
 */
export function PreviewRegistryLoader() {
    return null;
}
