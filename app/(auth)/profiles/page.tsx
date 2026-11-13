"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
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

const colors = ["#596869", "#85623c", "#425e91", "#825777", "#47745d", "#9c4848"];

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
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const opener = useRef<HTMLButtonElement | null>(null);

    const edit = (profile: Profile | "new", button: HTMLButtonElement) => {
        opener.current = button;
        setName(profile === "new" ? "" : profile.name);
        setColor(profile === "new" ? colors[profiles.length % colors.length] : profile.color ?? colors[0]);
        setConfirmDelete(false);
        setEditing(profile);
    };
    const save = async () => {
        setBusy(true);
        try {
            if (editing === "new") await createProfile(name.trim(), null, color);
            else if (editing) await updateProfile(editing.id, { name: name.trim(), color });
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

    return <main className={cn("min-h-dvh flex flex-col items-center justify-center gap-10 px-6 py-12", large && "text-tv-base")}>
        <header className="text-center space-y-3">
            <p className="text-xs tracking-widest uppercase text-muted-foreground">DebridUI · Profiles</p>
            <h1 className={cn("text-3xl font-light", large && "text-tv-hero")}>{manage ? "Manage profiles" : "Who's watching?"}</h1>
            {manage && <p className="text-muted-foreground">Choose a profile to edit</p>}
        </header>
        <div data-tv-section="profiles" className="flex w-full max-w-5xl flex-wrap justify-center gap-6">
            {profiles.map((profile) => <button key={profile.id} data-tv-focusable onClick={(e) => {
                if (manage) edit(profile, e.currentTarget);
                else void switchProfile(profile.id).then(() => router.push("/dashboard")).catch(() => toast.error("Could not switch profile"));
            }} className={cn("group flex w-[calc(50%-0.75rem)] min-w-0 flex-col items-center gap-3 p-2 outline-none focus-visible:ring-3 focus-visible:ring-primary sm:w-44", large && "sm:w-56", profile.id === activeProfile.id && "ring-2 ring-primary ring-offset-1 ring-offset-background")} aria-label={manage ? `Edit ${profile.name}` : `Watch as ${profile.name}`}>
                <span style={{ backgroundColor: profile.color ?? colors[0] }} className={cn("relative flex aspect-square w-full items-center justify-center text-5xl text-white", large && "min-h-40 text-tv-hero")}>
                    {profile.name[0]?.toUpperCase()}
                    {manage && <Pencil className="absolute bottom-3 right-3 size-5" />}
                </span>
                <span className="max-w-full truncate">{profile.name}</span>
            </button>)}
            <button data-tv-focusable onClick={(e) => edit("new", e.currentTarget)} className={cn("flex w-[calc(50%-0.75rem)] flex-col items-center gap-3 p-2 outline-none focus-visible:ring-3 focus-visible:ring-primary sm:w-44", large && "sm:w-56")}>
                <span className={cn("flex aspect-square w-full items-center justify-center border border-border/50 bg-muted/30 hover:bg-muted/50", large && "min-h-40")}><Plus className="size-12" /></span>
                <span>Add profile</span>
            </button>
        </div>
        <div data-tv-section="profile-actions"><Button data-tv-focusable variant="outline" className="min-h-phone-touch" onClick={() => setManage(!manage)}>{manage ? "Done" : "Manage profiles"}</Button></div>
        <Dialog open={editing !== null} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
            <DialogContent showCloseButton={false} onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }} className={cn("shadow-none", large && "sm:max-w-2xl text-tv-base")}>
                <DialogTitle>{editing === "new" ? "Add profile" : "Edit profile"}</DialogTitle>
                <DialogDescription>{confirmDelete ? "Delete this profile and its watch history? This cannot be undone." : "Choose a name and colour."}</DialogDescription>
                <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-5">
                    {!confirmDelete && <>
                        <div data-tv-section="profile-name" className="space-y-2"><Label htmlFor="profile-name">Name</Label><Input id="profile-name" data-tv-focusable autoFocus maxLength={50} required value={name} onChange={(e) => setName(e.target.value)} className="min-h-phone-touch" /></div>
                        <div data-tv-section="profile-colors" className="flex flex-wrap gap-3" role="group" aria-label="Profile colour">{colors.map((value) => <button key={value} type="button" data-tv-focusable aria-label={`Colour ${value}`} aria-pressed={value === color} onClick={() => setColor(value)} style={{ backgroundColor: value }} className={cn("size-12 outline-none focus-visible:ring-3 focus-visible:ring-primary", value === color && "ring-2 ring-primary ring-offset-2 ring-offset-background")} />)}</div>
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
