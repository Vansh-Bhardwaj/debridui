// Stub that prevents @vercel/og from being bundled in the Cloudflare Worker.
// We don't use ImageResponse / next/og anywhere — this saves ~2 MB from the bundle.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ImageResponse = undefined as any;
export default {};
