import { AuthPage } from "@/components/auth/AuthPage";

export const JOIN_TITLE = "Join · Dialogue Society Volunteer Hub";
export const JOIN_DESCRIPTION =
  "Create your Dialogue Society account: follow your local branch's events or apply to volunteer.";

/** The join page (/ and /join): the public top bar above the sign-up form. */
export function JoinPage({ redirect }: { redirect?: string | undefined }) {
  return <AuthPage redirect={redirect} initialMode="signup" />;
}
