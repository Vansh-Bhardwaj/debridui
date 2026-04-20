import { SUBTITLE_SYMBOL_FONT_FALLBACK } from "@/lib/utils/subtitles";

export function LegacyPlayerSubtitleStyle() {
    // Styles for manual subtitle overlay (bypasses Windows OS ::cue style override)
    const subFontStack = `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`;
    return (
        <style jsx global>{`
            /* Manual subtitle overlay styling */
            .debridui-subtitle-text {
                color: #fff;
                /* Base crisp text shadow */
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.4);
                line-height: 1.35;
                font-family: ${subFontStack};
                font-weight: 500;
                letter-spacing: 0.01em;
                font-variant-emoji: emoji;
                border-radius: 6px;
                transition: background-color 200ms ease, text-shadow 200ms ease;
            }

            /* Background modes */
            .debridui-sub-bg-solid .debridui-subtitle-text {
                background: rgba(0, 0, 0, 0.85);
                padding: 4px 12px;
                text-shadow: none; /* No shadow needed on solid black */
            }
            .debridui-sub-bg-semi .debridui-subtitle-text {
                background: rgba(0, 0, 0, 0.45);
                padding: 4px 12px;
            }
            .debridui-sub-bg-outline .debridui-subtitle-text {
                background: transparent;
                /* Sharp black outline + soft drop shadow */
                text-shadow: 
                    -1px -1px 0 #000,  
                     1px -1px 0 #000,
                    -1px  1px 0 #000,
                     1px  1px 0 #000,
                     0px  2px 6px rgba(0, 0, 0, 0.9);
            }
            .debridui-sub-bg-none .debridui-subtitle-text {
                background: transparent;
                /* Heavy drop shadow for readability without outline */
                text-shadow: 
                    0 1px 4px rgba(0, 0, 0, 1),
                    0 2px 10px rgba(0, 0, 0, 0.8),
                    0 0 16px rgba(0, 0, 0, 0.5);
            }

            .debridui-subs-small .debridui-subtitle-text { font-size: 0.9rem; }
            .debridui-subs-medium .debridui-subtitle-text { font-size: 1.25rem; }
            .debridui-subs-large .debridui-subtitle-text { font-size: 1.6rem; }

            /* Fallback: native ::cue styling for iOS */
            .debridui-legacy-player video::cue {
                line-height: 1.35;
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.6);
                font-family: ${subFontStack};
                font-weight: 500;
                font-variant-emoji: emoji;
            }
        `}</style>
    );
}
