import { SUBTITLE_SYMBOL_FONT_FALLBACK } from "@/lib/utils/subtitles";

export function LegacyPlayerSubtitleStyle() {
    // Styles for manual subtitle overlay (bypasses Windows OS ::cue style override)
    const subFontStack = `"Trebuchet MS", "Segoe UI", "Avenir Next", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif, ${SUBTITLE_SYMBOL_FONT_FALLBACK}`;
    return (
        <style jsx global>{`
            /* Manual subtitle overlay styling — default (semi-transparent background) */
            .debridui-subtitle-text {
                color: #fff;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.88), 0 0 10px rgba(0, 0, 0, 0.55);
                line-height: 1.4;
                letter-spacing: 0.01em;
                font-weight: 450;
                /* Musical symbols / emoji: mono/serif faces often lack these glyphs without an explicit fallback stack */
                font-family: ${subFontStack};
                font-variant-emoji: emoji;
            }

            /* Background modes */
            .debridui-sub-bg-solid .debridui-subtitle-text {
                background: rgba(0, 0, 0, 0.9);
            }
            .debridui-sub-bg-semi .debridui-subtitle-text {
                background: rgba(0, 0, 0, 0.55);
                backdrop-filter: blur(2px);
            }
            .debridui-sub-bg-outline .debridui-subtitle-text {
                background: transparent;
                text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.8);
            }
            .debridui-sub-bg-none .debridui-subtitle-text {
                background: transparent;
                text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 8px rgba(0, 0, 0, 0.7);
            }

            .debridui-subs-small .debridui-subtitle-text {
                font-size: 0.875rem;
            }

            .debridui-subs-medium .debridui-subtitle-text {
                font-size: 1.125rem;
            }

            .debridui-subs-large .debridui-subtitle-text {
                font-size: 1.5rem;
            }

            /* Fallback: native ::cue styling for iOS */
            .debridui-legacy-player video::cue {
                line-height: 1.4;
                text-shadow: 0 0 4px rgba(0, 0, 0, 0.9);
                font-family: ${subFontStack};
                font-variant-emoji: emoji;
            }
        `}</style>
    );
}
