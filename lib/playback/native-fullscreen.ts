export type NativeFullscreenVideo = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
};

/** Call directly from a tap handler; awaiting playback loses Safari's user gesture. */
export function enterNativeFullscreen(video: NativeFullscreenVideo): boolean {
    if (!video.webkitEnterFullscreen) return false;
    try {
        video.webkitEnterFullscreen();
        return true;
    } catch {
        // Safari can reject this before metadata is loaded. Playback can still enter fullscreen.
        return false;
    }
}
