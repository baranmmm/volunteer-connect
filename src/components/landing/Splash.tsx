/**
 * Shown while "/" starts (also rendered into the server shell, so the first paint is not blank) and while a signed-in
 * member is sent on to /dashboard. Deliberately neutral: the logo only, no landing content.
 */
export function Splash() {
  return (
    <div
      className="landing flex min-h-screen items-center justify-center"
      data-testid="landing-splash"
    >
      <div className="flex items-center gap-3">
        <img src="/brand/ds-logo-glow.svg" alt="" width={56} height={56} className="h-14 w-14" />
        <span className="text-xl font-semibold tracking-tight text-ds-logo">Dialogue Society</span>
      </div>
    </div>
  );
}
