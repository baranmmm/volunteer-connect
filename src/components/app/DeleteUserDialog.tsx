import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { deleteUser } from "@/lib/delete-user.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Target = { id: string; fullName: string; requestId?: string | null };

export function DeleteUserDialog({ target, onClose, onDeleted }: { target: Target | null; onClose: () => void; onDeleted: () => void }) {
  const run = useServerFn(deleteUser);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = target?.fullName.trim() ?? "";
  const matches = name !== "" && typed.trim() === name;

  async function confirm() {
    if (!target || !matches) return;
    setBusy(true); setError("");
    try {
      await run({ data: { userId: target.id, requestId: target.requestId ?? null } });
      toast.success("User deleted");
      setTyped("");
      onDeleted();
    } catch (e) { setError(e instanceof Error ? e.message : "The user could not be deleted"); }
    finally { setBusy(false); }
  }

  return <Dialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setTyped(""); setError(""); onClose(); } }}>
    <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Delete user</DialogTitle>
        <DialogDescription>This permanently deletes {name || "this user"}'s account and personal details. It cannot be undone. Their history entries are kept and will show as "Former member".</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="confirm-name">Type <span className="font-semibold">{name || "the user's full name"}</span> to confirm</Label>
        <Input id="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="h-11" disabled={!name} />
        {!name && <p className="text-sm text-muted-foreground">This user has no name on file, so they cannot be deleted from here.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={busy || !matches} onClick={confirm}>{busy ? "Deleting…" : "Delete permanently"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
