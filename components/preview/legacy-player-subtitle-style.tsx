export function LegacyPlayerSubtitleStyle() {
    // Styles for manual subtitle overlay (bypasses Windows OS ::cue style override)
    return (
        <style jsx global>{`
            /* Manual subtitle overlay styling */
            .debridui-subtitle-text {
                color: #fff;
                background: rgba(0, 0, 0, 0.75);
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
                line-height: 1.4;
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
            }
        `}</style>
    );
}
