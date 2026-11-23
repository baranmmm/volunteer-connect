import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), deleteUser: vi.fn(), blockUser: vi.fn(), permission: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ middleware: () => ({ inputValidator: () => ({ handler: (handler: unknown) => handler }) }) }) }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/require-member", () => ({ requireMember: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc, auth: { admin: { deleteUser: mocks.deleteUser, updateUserById: mocks.blockUser } } } }));
import { deleteUser } from "@/lib/delete-user.functions";

const actor = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const audit = "33333333-3333-4333-8333-333333333333";
const run = deleteUser as unknown as (args: unknown) => Promise<unknown>;
const input = { data: { userId: target, requestId: null }, context: { userId: actor, supabase: { rpc: mocks.permission } } };
beforeEach(() => { vi.resetAllMocks(); mocks.permission.mockResolvedValue({ data: true }); mocks.rpc.mockResolvedValue({ data: audit, error: null }); mocks.blockUser.mockResolvedValue({ error: null }); });
describe("Resilient deletion flow", () => {
  it("awaits the audit before blocking sign-in without erasing Auth, then completes the request", async () => {
    await run(input);
    expect(mocks.rpc.mock.calls.map((call) => call[0])).toEqual(["authorize_user_deletion", "record_user_deletion"]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.blockUser.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.blockUser).toHaveBeenCalledWith(target, { ban_duration: '876000h' });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_user_deletion", { _actor: actor, _target: target, _audit: audit });
  });
  it("does not delete when audit insertion fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { message: "Audit unavailable" } });
    await expect(run(input)).rejects.toThrow("Audit unavailable");
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it.each(["returned error", "thrown error"])("records a failed admin deletion (%s) and shows a clear error", async (kind) => {
    if (kind === "returned error") mocks.blockUser.mockResolvedValue({ error: { message: "Failure" } });
    else mocks.blockUser.mockRejectedValue(new Error("Failure"));
    await expect(run(input)).rejects.toThrow("any related deletion request remains pending");
    expect(mocks.rpc).toHaveBeenLastCalledWith("record_user_deletion_failure", { _actor: actor, _target: target, _audit: audit });
    expect(mocks.rpc.mock.calls.map((call) => call[0])).not.toContain("record_user_deletion");
  });
});