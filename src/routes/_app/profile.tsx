import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, primaryRole, ROLE_LABELS } from "@/lib/auth";
import { pageHead } from "@/components/app/head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_app/profile")({
  head: () => pageHead("Profile", "Manage your volunteer profile."),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, roles, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!profile) return null;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: String(f.get("full_name")).trim(), phone: String(f.get("phone")).trim() })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Profile saved");
    refresh();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Profile</h1>
      <form onSubmit={submit} className="max-w-xl space-y-5 rounded-2xl border bg-card p-6 shadow-soft">
        <div className="space-y-2">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" defaultValue={profile.full_name} required className="h-12 rounded-xl" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} className="h-12 rounded-xl" />
        </div>
        <dl className="grid gap-4 border-t pt-5 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Email</dt><dd className="font-medium break-all">{profile.email}</dd></div>
          <div><dt className="text-muted-foreground">Role</dt><dd className="font-medium">{ROLE_LABELS[primaryRole(roles)]}</dd></div>
          <div><dt className="text-muted-foreground">Branch</dt><dd className="font-medium">{profile.branches?.name ?? "—"}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">Your role and branch can only be changed by your Branch Manager.</p>
        <Button type="submit" className="h-12 rounded-xl px-6" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </form>
    </div>
  );
}
