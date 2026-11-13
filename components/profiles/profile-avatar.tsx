import { Cake, Cat, Clapperboard, Coffee, Crown, EmojiHappy, Fire, Gamepad, GemSparkle, GhostSmile, Headphones, Leaf, MagicWand, MaskHappy, MoonStars, MusicNote, Paw, PizzaSlice, Planet, Rocket, Star, StickerSmile, Ufo, type IconComponent } from "reicon-react";
import { cn } from "@/lib/utils";

// Vivid on purpose: profiles are the one place the app is playful. White icons stay readable on each.
export const profileColors = ["#1E88E5", "#E53935", "#2E9E5B", "#F4791F", "#8E5BD8", "#D63F8C", "#00A3A3", "#3F51B5"];
// Profiles saved with the first, muted palette pick up their vivid counterpart.
const legacyColors: Record<string, string> = {
    "#596869": "#1E88E5", "#85623c": "#F4791F", "#425e91": "#3F51B5",
    "#825777": "#8E5BD8", "#47745d": "#2E9E5B", "#9c4848": "#E53935",
};
export const profileColor = (color?: string | null) => (color && (legacyColors[color] ?? color)) || profileColors[0];

export const profileIcons: Record<string, IconComponent> = {
    smile: EmojiHappy, sticker: StickerSmile, ghost: GhostSmile, cat: Cat, paw: Paw, ufo: Ufo,
    rocket: Rocket, planet: Planet, moon: MoonStars, crown: Crown, mask: MaskHappy, star: Star,
    flame: Fire, gem: GemSparkle, wand: MagicWand, gamepad: Gamepad, headphones: Headphones, music: MusicNote,
    pizza: PizzaSlice, cake: Cake, coffee: Coffee, clapperboard: Clapperboard, leaf: Leaf,
};
const iconKeys = Object.keys(profileIcons);

// Profiles created before icons existed get a stable pick from their id, never a bare letter.
export function defaultProfileIcon(seed: string) {
    let hash = 0;
    for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
    return iconKeys[hash % iconKeys.length];
}

export function ProfileAvatar({ profile, className }: {
    profile: { id: string; name: string; color?: string | null; avatar?: string | null };
    className?: string;
}) {
    const Icon = profileIcons[profile.avatar ?? ""] ?? profileIcons[defaultProfileIcon(profile.id)];
    return (
        <span
            aria-hidden
            style={{ backgroundColor: profileColor(profile.color) }}
            className={cn("relative flex aspect-square shrink-0 items-center justify-center overflow-hidden text-white", className)}>
            {/* Flat two-tone: a lighter upper half gives depth without a gradient. */}
            <span className="absolute inset-x-0 top-0 h-1/2 bg-white/10" />
            <Icon weight="Filled" className="relative size-[55%] drop-shadow-[0_1px_0_rgb(0_0_0/0.15)]" />
        </span>
    );
}
