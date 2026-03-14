// Stub that prevents @vercel/og from being bundled in the Cloudflare Worker.
// We don't use ImageResponse / next/og anywhere — this saves ~2 MB from the bundle.
export const ImageResponse = undefined;
const ogStub = {};
export default ogStub;
