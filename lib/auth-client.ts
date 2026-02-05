"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// Create auth client - the Next.js adapter takes no arguments
// Session persistence is configured server-side via createNeonAuth in lib/auth.ts
export const authClient = createAuthClient();
