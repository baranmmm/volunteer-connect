import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/auth";

const mock = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  role: "regional_director",
  status: "active",
  branch: "Medway",
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    onAuthStateChange: vi.fn((listener) => { mock.listener = listener; return { data: { subscription: { unsubscribe: vi.fn() } } }; }),
    getSession: async () => ({ data: { session: { user: { id: "actor" }, access_token: "test" } } }),
  },
  from: (table: string) => ({ select: () => ({ eq: () => table === "profiles" ? {
    maybeSingle: async () => ({ data: { id: "actor", status: mock.status, branches: { name: mock.branch } } }),
  } : Promise.resolve({ data: [{ role: mock.role }] }) }) }),
} }));

function Account() {
  const { profile, roles, loading } = useAuth();
  return <output>{loading ? "Loading" : `${roles[0]} / ${profile?.status} / ${profile?.branches?.name}`}</output>;
}
afterEach(cleanup);
describe("Account changes from another session", () => {
  it("reloads role, status, and branch on token refresh without remounting", async () => {
    mock.role = "regional_director"; mock.status = "active"; mock.branch = "Medway";
    render(<AuthProvider><Account /></AuthProvider>);
    await screen.findByText("regional_director / active / Medway");
    mock.role = "volunteer"; mock.status = "inactive"; mock.branch = "Brighton";
    act(() => mock.listener?.("TOKEN_REFRESHED", { user: { id: "actor" }, access_token: "refreshed" }));
    await waitFor(() => expect(screen.getByText("volunteer / inactive / Brighton")).toBeInTheDocument());
  });
});