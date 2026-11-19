import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchRegionGroups, type RegionGroup } from "@/lib/branches";
import { Logo } from "@/components/app/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Dialogue Society Volunteer Hub" },
      { name: "description", content: "Sign in or create your volunteer account." },
      { property: "og:title", content: "Sign in · Dialogue Society Volunteer Hub" },
      { property: "og:description", content: "Sign in or create your volunteer account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  if (!loading && session) return <Navigate to="/dashboard" replace />;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-hero p-12 text-primary-foreground lg:flex">
        <Logo />
        <div>
          <h1 className="text-4xl font-semibold leading-tight">Bringing communities together, one conversation at a time.</h1>
          <p className="mt-4 max-w-md text-lg opacity-90">Your home for volunteering with Dialogue Society.</p>
        </div>
        <p className="text-sm opacity-75">Dialogue Society · Registered UK charity</p>
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <Logo className="mb-8 text-primary lg:hidden" />
          {mode === "signin" && <SignIn setMode={setMode} />}
          {mode === "signup" && <SignUp setMode={setMode} />}
          {mode === "forgot" && <Forgot setMode={setMode} />}
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-12 rounded-xl" {...props} />
    </div>
  );
}

function SignIn({ setMode }: { setMode: (m: Mode) => void }) {
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setBusy(false);
    if (error) toast.error(error.message);
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-3xl font-semibold">Welcome back</h2>
        <p className="mt-1 text-muted-foreground">Sign in to your volunteer account.</p>
      </div>
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <Field id="password" name="password" type="password" label="Password" autoComplete="current-password" required />
      <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("forgot")}>
          Forgotten your password?
        </button>
        <button type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signup")}>
          Create an account
        </button>
      </div>
    </form>
  );
}

function SignUp({ setMode }: { setMode: (m: Mode) => void }) {
  const [groups, setGroups] = useState<RegionGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    fetchRegionGroups().then(setGroups).catch(() => toast.error("Could not load branches"));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const branch_id = String(f.get("branch") || "");
    if (!branch_id) { toast.error("Please choose your branch"); return; }
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: String(f.get("email")),
      password: String(f.get("password")),
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: String(f.get("full_name")), phone: String(f.get("phone")), branch_id },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!data.session) setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h2 className="text-3xl font-semibold">Check your email</h2>
        <p className="text-muted-foreground">We've sent you a link to confirm your email address. Once confirmed, your Branch Manager will review your account.</p>
        <Button variant="outline" className="h-12 rounded-xl" onClick={() => setMode("signin")}>Back to sign in</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-3xl font-semibold">Join as a volunteer</h2>
        <p className="mt-1 text-muted-foreground">Your Branch Manager will approve your account.</p>
      </div>
      <Field id="full_name" name="full_name" label="Full name" autoComplete="name" required />
      <Field id="email" name="email" type="email" label="Email" autoComplete="email" required />
      <Field id="phone" name="phone" type="tel" label="Phone" autoComplete="tel" required />
      <Field id="password" name="password" type="password" label="Password" autoComplete="new-password" minLength={8} required />
      <div className="space-y-2">
        <Label htmlFor="branch">Branch</Label>
        <select id="branch" name="branch" required defaultValue="" className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring">
          <option value="" disabled>Choose your branch</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.name}>
              {g.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <Button type="submit" size="lg" className="h-12 w-full rounded-xl" disabled={busy}>
        {busy ? "Creating account…" : "Create account"}
      </Button>
      <button type="button" className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
        Already have an account? Sign in
      </button>
    </form>
  );
}

function Forgot({ setMode }: { setMode: (m: Mode) => void }) {
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.auth.resetPasswordForEmail(String(f.get("email")), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) toast.error(error.message);
    else setSent(true);
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <h2 className="text-3xl font-semibold">Reset your password</h2>
        <p className="mt-1 text-muted-foreground">
          {sent ? "If an account exists for that email, we've sent a reset link." : "Enter your email and we'll send you a link."}
        </p>
      </div>
      {!sent && <Field id="email" name="email" type="email" label="Email" required />}
      {!sent && <Button type="submit" size="lg" className="h-12 w-full rounded-xl">Send reset link</Button>}
      <button type="button" className="min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => setMode("signin")}>
        Back to sign in
      </button>
    </form>
  );
}
