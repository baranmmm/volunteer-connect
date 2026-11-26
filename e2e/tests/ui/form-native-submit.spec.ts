// Server-rendered forms before hydration: a click or Enter before React runs must never submit natively. A native
// GET would put every field (email, password, phone) in the URL, the browser history and server logs. With every
// script blocked the page never hydrates: the submit button is disabled (so neither the button nor Enter submits),
// the forms use method="post", and no request carries the typed values. After hydration the button works again.
import type { Page, Request } from "@playwright/test";
import { test, expect } from "../../fixtures/roles";
import { APP_LOAD_TIMEOUT } from "../../pages/app";

const EMAIL = "no-native-submit@example.test";
const PASSWORD = "never-in-a-url-Passw0rd";
const PHONE = "07000111222";

/** Blocks every script (so the server-rendered page never hydrates) and records every request after the page load. */
async function withoutScripts(page: Page) {
  await page.route("**/*", (route) => (route.request().resourceType() === "script" ? route.abort() : route.continue()));
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  return requests;
}

/** No request (URL or body) carried a typed value, and the page URL has none either. */
function expectNothingSent(page: Page, requests: Request[], values: string[]) {
  for (const value of values) {
    const encoded = encodeURIComponent(value);
    expect(page.url()).not.toContain(encoded);
    for (const r of requests) {
      expect(r.url(), `request ${r.method()} ${r.url()}`).not.toContain(encoded);
      expect(r.postData() ?? "", `request body of ${r.method()} ${r.url()}`).not.toContain(value);
    }
  }
}

/** Both native submit paths: Enter in a field, then a click on the (disabled) button dispatched in the page. */
async function trySubmitNatively(page: Page, formTestId: string, submitTestId: string, field: string) {
  const form = page.getByTestId(formTestId);
  await expect(form).toHaveAttribute("method", "post");
  const submit = form.getByTestId(submitTestId);
  await expect(submit).toBeDisabled();
  await form.getByTestId(field).press("Enter");
  await submit.evaluate((button: HTMLButtonElement) => button.click());
  // Give a native submission time to start a navigation, if one were going to.
  await page.waitForLoadState("load");
}

test.describe("Server-rendered forms never submit natively before hydration", () => {
  test("sign in (/sign-in): no email or password in the URL or any request", async ({ page }) => {
    const requests = await withoutScripts(page);
    await page.goto("/sign-in");
    const form = page.getByTestId("auth-sign-in-form");
    await form.getByTestId("auth-email-input").fill(EMAIL);
    await form.getByTestId("auth-password-input").fill(PASSWORD);
    const before = page.url();
    await trySubmitNatively(page, "auth-sign-in-form", "auth-submit-button", "auth-password-input");
    expect(page.url()).toBe(before);
    expectNothingSent(page, requests, [EMAIL, PASSWORD]);
  });

  for (const path of ["/join", "/"] as const) {
    test(`sign up (${path}): no email, password or phone in the URL or any request`, async ({ page }) => {
      const requests = await withoutScripts(page);
      await page.goto(path);
      const form = page.getByTestId("auth-sign-up-form");
      await form.getByTestId("auth-email-input").fill(EMAIL);
      for (const input of await form.locator('input[type="password"]').all()) await input.fill(PASSWORD);
      const phone = form.locator('input[type="tel"]');
      if (await phone.count()) await phone.first().fill(PHONE);
      const before = page.url();
      await trySubmitNatively(page, "auth-sign-up-form", "auth-submit-button", "auth-email-input");
      expect(page.url()).toBe(before);
      expectNothingSent(page, requests, [EMAIL, PASSWORD, PHONE]);
    });
  }

  test("after hydration the sign-in button is enabled again", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.locator("html[data-hydrated]")).toBeAttached({ timeout: APP_LOAD_TIMEOUT });
    await expect(page.getByTestId("auth-sign-in-form").getByTestId("auth-submit-button")).toBeEnabled();
  });
});
