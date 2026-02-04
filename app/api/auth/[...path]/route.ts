import { auth } from "@/lib/auth";

// Neon Auth handler - proxies all auth requests to Neon Auth server
export const { GET, POST } = auth.handler();
