import { Sparkles } from "lucide-react";

export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      <div className="rounded-2xl border bg-card p-10 text-center shadow-soft">
        <Sparkles className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold">Coming soon</h2>
        <p className="mt-2 text-muted-foreground">We're working on this part of the hub. Check back shortly.</p>
      </div>
    </div>
  );
}
