import { AuthPage } from "@/components/auth/AuthPage";
import { LandingHeader } from "@/components/landing/LandingHeader";

export const JOIN_TITLE = "Join · Dialogue Society Volunteer Hub";
export const JOIN_DESCRIPTION =
  "Create your Dialogue Society account: follow your local branch's events or apply to volunteer.";

/** The join page (/ and /join): the top bar (logo, Events, Sign in) above the sign-up form. */
export function JoinPage({ redirect }: { redirect?: string | undefined }) {
  return (
    <AuthPage redirect={redirect} initialMode="signup" header={<LandingHeader join={false} />} />
  );
}
