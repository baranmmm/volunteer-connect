import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyDeletionRequest, requestAccountDeletion, cancelAccountDeletion } from "@/lib/members";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const qc = useQueryClient();
  const isDirector = roles.includes("regional_director");
  const myRequest = useQuery({ queryKey: ["my-deletion-request", profile?.id], queryFn: () => fetchMyDeletionRequest(profile!.id), enabled: !!profile && !isDirector });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  if (!profile) return null;

  async function runDeletion(kind: "request" | "cancel") {
    setDeleteBusy(true);
    try {
      if (kind === "request") await requestAccountDeletion(); else await cancelAccountDeletion();
      toast.success(kind === "request" ? "Deletion request sent" : "Deletion request cancelled");
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey: ["my-deletion-request"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setDeleteBusy(false); }
  }

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
      <section aria-labelledby="delete-h" className="max-w-xl space-y-3 rounded-2xl border bg-card p-6 shadow-soft">
        <h2 id="delete-h" className="text-xl font-semibold">Delete my account</h2>
        {isDirector ? (
          <p className="text-sm text-muted-foreground">Regional Directors can't request deletion in the app. Please contact the Dialogue Society office to close your account.</p>
        ) : myRequest.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : myRequest.data ? (
          <>
            <p className="text-sm">You asked to delete your account on {new Date(myRequest.data.requested_at).toLocaleDateString("en-GB")}. A manager will process it within 30 days.</p>
            <Button variant="outline" className="h-11 rounded-xl" disabled={deleteBusy} onClick={() => runDeletion("cancel")}>{deleteBusy ? "Cancelling…" : "Cancel deletion request"}</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Ask for your account and personal details to be permanently deleted.</p>
            <Button variant="destructive" className="h-11 rounded-xl" onClick={() => setConfirmOpen(true)}>Delete my account</Button>
          </>
        )}
      </section>
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!deleteBusy) setConfirmOpen(o); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request account deletion?</DialogTitle>
            <DialogDescription>Your request goes to your manager, who will process it within 30 days as required by UK GDPR. Once processed, your account and personal details are permanently deleted. You can cancel the request until then.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={deleteBusy} onClick={() => setConfirmOpen(false)}>Keep my account</Button>
            <Button variant="destructive" disabled={deleteBusy} onClick={() => runDeletion("request")}>{deleteBusy ? "Sending…" : "Request deletion"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
