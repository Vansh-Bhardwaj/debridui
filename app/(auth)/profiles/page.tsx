"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pen as Pencil } from "reicon-react";
import { toast } from "sonner";
import { useProfile, type Profile } from "@/hooks/use-profile";
import { useDevice } from "@/components/device/device-provider";
import { useTVMode } from "@/hooks/use-tv-mode";
import { useTVFocus } from "@/hooks/use-tv-focus";
import { createProfile, updateProfile, deleteProfile } from "@/lib/actions/profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ProfileAvatar, defaultProfileIcon, profileColor, profileColors as colors, profileIcons } from "@/components/profiles/profile-avatar";

function greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function ProfilesScreen() {
    const { profiles, activeProfile, switchProfile, refresh } = useProfile();
    const { isTV } = useDevice();
    const { tvMode } = useTVMode();
    useTVFocus();
    const large = isTV || tvMode;
    const router = useRouter();
    const params = useSearchParams();
    const [manage, setManage] = useState(params.get("manage") === "1");
    const [editing, setEditing] = useState<Profile | "new" | null>(null);
    const [name, setName] = useState("");
    const [color, setColor] = useState(colors[0]);
    const [avatar, setAvatar] = useState("smile");
    const [glow, setGlow] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const opener = useRef<HTMLButtonElement | null>(null);

    const edit = (profile: Profile | "new", button: HTMLButtonElement) => {
        opener.current = button;
        setName(profile === "new" ? "" : profile.name);
        setColor(profile === "new" ? colors[profiles.length % colors.length] : profileColor(profile.color));
        setAvatar(profile === "new" ? defaultProfileIcon(String(Date.now())) : profile.avatar ?? defaultProfileIcon(profile.id));
        setConfirmDelete(false);
        setEditing(profile);
    };
    const save = async () => {
        setBusy(true);
        try {
            if (editing === "new") await createProfile(name.trim(), avatar, color);
            else if (editing) await updateProfile(editing.id, { name: name.trim(), avatar, color });
            await refresh();
            setEditing(null);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save profile"); }
        finally { setBusy(false); }
    };
    const remove = async () => {
        if (!editing || editing === "new") return;
        setBusy(true);
        try {
            // Move off the profile before deletion so tokens and pending saves are reset.
            if (editing.id === activeProfile.id) await switchProfile(profiles.find((p) => p.id !== editing.id)!.id);
            await deleteProfile(editing.id);
            await refresh();
            setEditing(null);
        } catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete profile"); }
        finally { setBusy(false); }
    };

    const tile = cn("group flex w-[calc(50%-0.75rem)] min-w-0 flex-col items-center gap-4 outline-none sm:w-40 lg:w-44", large && "sm:w-56");
    // White outline on hover/focus, like the frame around a poster you're about to pick.
    const frame = "w-full outline-0 outline-offset-4 outline-white transition-[outline-width,transform] duration-200 ease-premium group-hover:outline-3 group-focus-visible:outline-3 group-hover:scale-[1.04] group-focus-visible:scale-[1.04]";

    return <main className={cn("relative min-h-dvh overflow-hidden flex flex-col items-center justify-center gap-12 px-6 py-12", large && "text-tv-base")}>
        {/* Ambient glow takes the focused profile's colour (as in Nuvio); the one decorative wash in the app. */}
        <div aria-hidden style={{ backgroundColor: glow ?? profileColor(activeProfile.color) }} className="pointer-events-none absolute left-1/2 top-[40%] size-[70vmax] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-[0.18] blur-[140px] transition-colors duration-700" />
        <header className="relative text-center space-y-3">
            <p className="text-xs tracking-widest uppercase text-muted-foreground">{manage ? "Profiles" : greeting()}</p>
            <h1 className={cn("text-4xl font-light sm:text-5xl", large && "text-tv-hero")}>{manage ? "Manage profiles" : "Who's watching?"}</h1>
            {manage && <p className="text-muted-foreground">Choose a profile to edit</p>}
        </header>
        <div data-tv-section="profiles" className="relative flex w-full max-w-5xl flex-wrap justify-center gap-x-6 gap-y-10 sm:gap-x-10" onMouseLeave={() => setGlow(null)}>
            {profiles.map((profile) => <button key={profile.id} data-tv-focusable onMouseEnter={() => setGlow(profileColor(profile.color))} onFocus={() => setGlow(profileColor(profile.color))} onClick={(e) => {
                if (manage) edit(profile, e.currentTarget);
                else void switchProfile(profile.id).then(() => router.push("/dashboard")).catch(() => toast.error("Could not switch profile"));
            }} className={tile} aria-label={manage ? `Edit ${profile.name}` : `Watch as ${profile.name}`}>
                <span className={cn("relative block", frame)}>
                    <ProfileAvatar profile={profile} className={cn("w-full", large && "min-h-40")} />
                    {manage && <span className="absolute inset-0 flex items-center justify-center bg-black/45"><Pencil className="size-7 text-white" /></span>}
                </span>
                <span className="flex max-w-full items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground">
                    <span className={cn("truncate text-base", large && "text-tv-base")}>{profile.name}</span>
                    {profile.id === activeProfile.id && <span aria-label="Current profile" className="size-1.5 shrink-0 bg-primary" />}
                </span>
            </button>)}
            <button data-tv-focusable onMouseEnter={() => setGlow("#ffffff")} onFocus={() => setGlow("#ffffff")} onClick={(e) => edit("new", e.currentTarget)} className={tile}>
                <span className={cn("flex aspect-square items-center justify-center border-2 border-dashed border-border text-muted-foreground group-hover:border-white group-hover:text-foreground group-focus-visible:text-foreground", frame, large && "min-h-40")}><Plus className="size-12" strokeWidth={1.5} /></span>
                <span className="text-base text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground">Add profile</span>
            </button>
        </div>
        <div data-tv-section="profile-actions" className="relative"><Button data-tv-focusable variant="outline" className="min-h-phone-touch tracking-widest uppercase text-xs" onClick={() => setManage(!manage)}>{manage ? "Done" : "Manage profiles"}</Button></div>
        <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
            <DialogContent showCloseButton={false} onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }} className={cn("shadow-none", large && "sm:max-w-2xl text-tv-base")}>
                <DialogTitle>{editing === "new" ? "Add profile" : "Edit profile"}</DialogTitle>
                <DialogDescription>{confirmDelete ? "Delete this profile and its watch history? This cannot be undone." : "Pick a name, an icon and a colour."}</DialogDescription>
                <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-5">
                    {!confirmDelete && <>
                        <div className="flex items-end gap-4">
                            <ProfileAvatar profile={{ id: "preview", name, color, avatar }} className="size-20" />
                            <div data-tv-section="profile-name" className="flex-1 space-y-2"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" data-tv-focusable autoFocus maxLength={50} required value={name} onChange={(e) => setName(e.target.value)} className="min-h-phone-touch" /></div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs tracking-widest uppercase text-muted-foreground">Icon</p>
                            <div data-tv-section="profile-icons" className="grid grid-cols-6 gap-2 sm:grid-cols-8" role="group" aria-label="Profile icon">{Object.entries(profileIcons).map(([key, Icon]) => <button key={key} type="button" data-tv-focusable aria-label={`Icon ${key}`} aria-pressed={key === avatar} onClick={() => setAvatar(key)} className={cn("flex aspect-square min-h-phone-touch items-center justify-center border border-border/50 bg-muted/30 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-primary sm:min-h-0", key === avatar && "border-primary bg-primary/15 text-primary")}><Icon className="size-5" /></button>)}</div>
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs tracking-widest uppercase text-muted-foreground">Colour</p>
                            <div data-tv-section="profile-colors" className="flex flex-wrap gap-3" role="group" aria-label="Profile colour">{colors.map((value) => <button key={value} type="button" data-tv-focusable aria-label={`Colour ${value}`} aria-pressed={value === color} onClick={() => setColor(value)} style={{ backgroundColor: value }} className={cn("size-11 outline-none focus-visible:ring-3 focus-visible:ring-primary", value === color && "ring-2 ring-primary ring-offset-2 ring-offset-background")} />)}</div>
                        </div>
                    </>}
                    <div data-tv-section="profile-editor-actions" className="flex flex-wrap gap-3">
                        <Button type="button" variant="outline" data-tv-focusable disabled={busy} className="min-h-phone-touch" onClick={() => confirmDelete ? setConfirmDelete(false) : setEditing(null)}>Cancel</Button>
                        {confirmDelete ? <Button type="button" variant="destructive" data-tv-focusable disabled={busy} className="min-h-phone-touch" onClick={() => void remove()}>Delete profile</Button> : <>
                            <Button type="submit" data-tv-focusable disabled={busy || !name.trim()} className="min-h-phone-touch">{busy ? "Saving…" : "Save"}</Button>
                            {editing !== "new" && profiles.length > 1 && <Button type="button" variant="destructive" data-tv-focusable disabled={busy} className="min-h-phone-touch" onClick={() => setConfirmDelete(true)}>Delete</Button>}
                        </>}
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    </main>;
}

export default function ProfilesPage() {
    return <Suspense><ProfilesScreen /></Suspense>;
}
