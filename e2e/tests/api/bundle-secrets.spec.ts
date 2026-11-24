// The service_role key is passed to the app server for the deleteUser server function.
// This checks it never reaches anything the browser downloads from the app.
import { test, expect } from "../../fixtures/roles";
import { baseUrl, requireEnv } from "../../setup/env";

test("no app-served script or document contains the service_role key", async ({ pageAs }) => {
  const secret = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const appHost = new URL(baseUrl()).host;
  const page = await pageAs("director");
  const leaks: string[] = [];
  const pending: Promise<void>[] = [];
  let checked = 0;

  page.on("response", (response) => {
    if (new URL(response.url()).host !== appHost) return;
    if (!["script", "document", "fetch", "xhr"].includes(response.request().resourceType())) return;
    pending.push(
      response
        .text()
        .then((body) => {
          checked++;
          if (body.includes(secret)) leaks.push(response.url());
        })
        .catch(() => undefined), // redirects and aborted responses have no body
    );
  });

  for (const path of ["/auth", "/dashboard", "/users", "/approvals", "/profile"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await Promise.all(pending);

  expect(checked, "should have inspected the app's scripts").toBeGreaterThan(0);
  expect(leaks, "service_role key found in browser-loaded resources").toEqual([]);
});
