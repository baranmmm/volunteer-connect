// "Get event updates" (double opt-in) on the signed-out landing page, the confirmation link and the unsubscribe link.
import { randomUUID } from "node:crypto";
import { test, expect, runId } from "../../fixtures/roles";
import { adminClient } from "../../api/SupabaseClient";
import { linkFrom, waitForEmail } from "../../api/outbox";
import { emailDomain } from "../../setup/env";
import { APP_LOAD_TIMEOUT } from "../../pages/app";
import { SubscribeForm } from "../../pages/public/SubscribeForm";
import { SubscriberLinkPage } from "../../pages/public/SubscriberLinkPage";
import { useOwnClientIp } from "../../pages/public/clientIp";
import { emailLinkToken } from "../../pages/public/linkTokens";

const subscriberEmail = () => `e2e-subscriber-${runId}-${randomUUID().slice(0, 8)}@${emailDomain()}`;

async function subscriber(email: string) {
  const { data, error } = await adminClient()
    .from("subscribers")
    .select("id, full_name, branch_id, source, consent_at, confirmed_at, unsubscribed_at")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(`read subscribers: ${error.message}`);
  return data;
}

test.describe("Event updates subscribers", () => {
  const created: string[] = [];
  test.afterEach(async () => {
    // Outbox rows of a subscriber go with it (ON DELETE CASCADE).
    if (created.length) await adminClient().from("subscribers").delete().in("email", created.splice(0));
  });

  test("subscribe, confirm with the email link (a click), then unsubscribe: pending announcements are cancelled", async ({ page, freshUser, freshEvent, seed }) => {
    test.setTimeout(90_000);
    const manager = await freshUser({ role: "branch_manager" });
    const event = await freshEvent(manager, { label: "announce", status: "published", startInMinutes: 4 * 24 * 60, audience: "public" });
    await useOwnClientIp(page);
    const email = subscriberEmail();
    created.push(email);
    await page.goto("/");
    // The landing page mounts the form when its section nears the screen.
    const section = page.getByTestId("landing-subscribe");
    await section.scrollIntoViewIfNeeded({ timeout: APP_LOAD_TIMEOUT });
    const form = new SubscribeForm(page, section);
    await form.subscribe({ email, name: "E2E Subscriber", branchId: seed.branches.Medway });
    const pending = await subscriber(email);
    expect(pending).toMatchObject({ source: "landing", branch_id: seed.branches.Medway, confirmed_at: null });

    const confirmEmail = await waitForEmail({ template: "subscriber_confirm", to: email });
    const link = new SubscriberLinkPage(page);
    await link.open(linkFrom(confirmEmail, "/updates/confirm"));
    await expect(link.confirmButton()).toBeVisible();
    expect((await subscriber(email))?.confirmed_at).toBeNull(); // opening the link is not a confirmation
    await link.confirmButton().click();
    await link.expectState("confirmed");
    expect((await subscriber(email))?.confirmed_at).not.toBeNull();

    // An announcement still waiting in the queue (held back so no sender run picks it up during the test).
    const sub = (await subscriber(email))!;
    const queued = await adminClient()
      .from("email_outbox")
      .insert({ template: "event_announcement", subscriber_id: sub.id, event_id: event.id, payload: {}, not_before: new Date(Date.now() + 86400000).toISOString() })
      .select("id")
      .single();
    if (queued.error) throw new Error(`queue announcement: ${queued.error.message}`);

    await link.open(`/updates/unsubscribe?t=${encodeURIComponent(await emailLinkToken("subscriber-unsubscribe", sub.id))}`);
    await link.unsubscribeButton().click();
    await link.expectState("unsubscribed");
    const after = await subscriber(email);
    expect(after?.unsubscribed_at).not.toBeNull();
    expect(after?.full_name).toBeNull();
    const { data: row } = await adminClient().from("email_outbox").select("status").eq("id", queued.data.id).single();
    expect(row?.status).toBe("cancelled");
  });

  test("one-click unsubscribe (RFC 8058): POST unsubscribes, GET only opens the page, a forged token is refused", async ({ page, request }) => {
    await useOwnClientIp(page);
    const email = subscriberEmail();
    created.push(email);
    const { data, error } = await adminClient()
      .from("subscribers")
      .insert({ email, source: "landing", confirmed_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throw new Error(`insert subscriber: ${error.message}`);
    const token = await emailLinkToken("subscriber-unsubscribe", data.id);
    const get = await request.get(`/api/public/unsubscribe?t=${encodeURIComponent(token)}`, { maxRedirects: 0 });
    expect(get.status()).toBe(303);
    expect((await subscriber(email))?.unsubscribed_at).toBeNull();
    const forged = await request.post(`/api/public/unsubscribe?t=${encodeURIComponent(`${data.id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)}`);
    expect(forged.status()).toBe(400);
    const post = await request.post(`/api/public/unsubscribe?t=${encodeURIComponent(token)}`, { form: { "List-Unsubscribe": "One-Click" } });
    expect(post.status()).toBe(200);
    expect((await subscriber(email))?.unsubscribed_at).not.toBeNull();
    // The page with the same link still asks for the click, and unsubscribing again is harmless.
    const link = new SubscriberLinkPage(page);
    await link.open(`/updates/unsubscribe?t=${encodeURIComponent(token)}`);
    await link.unsubscribeButton().click({ timeout: APP_LOAD_TIMEOUT });
    await link.expectState("unsubscribed");
  });
});
