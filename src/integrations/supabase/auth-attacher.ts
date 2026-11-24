import { createMiddleware } from "@tanstack/react-start";
import { supabase } from "./client";

// Sends the signed-in user's access token to protected server functions.
export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
