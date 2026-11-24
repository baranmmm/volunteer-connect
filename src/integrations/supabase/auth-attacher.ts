import { createMiddleware } from "@tanstack/react-start";
import { loadSupabase, needsAuthClientNow } from "@/lib/supabase-lazy";

// Sends the signed-in user's access token to protected server functions. Signed-out visitors of the public pages have
// no session to send, so their calls (public events, guest forms) never load the Supabase client for it.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    if (!needsAuthClientNow()) return next({ headers: {} });
    const supabase = await loadSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  },
);
