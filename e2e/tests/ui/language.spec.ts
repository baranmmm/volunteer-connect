import { test, expect, toastSuccess } from "../../fixtures/roles";
import { Sidebar } from "../../pages/components/Sidebar";
import { LanguageSwitcher } from "../../pages/components/LanguageSwitcher";
import { ProfilePage } from "../../pages/ProfilePage";
import { DashboardPage } from "../../pages/DashboardPage";
import { AuthPage } from "../../pages/AuthPage";
import { getProfile } from "../../api/SupabaseClient";

test.describe("Language", () => {
  test("the sign-in page toggle switches language and remembers it", async ({ page }) => {
    const auth = new AuthPage(page);
    const language = new LanguageSwitcher(page);
    await auth.goto();
    await language.expectLanguage("en");

    await language.chooseOnAuth("tr");
    await language.expectLanguage("tr");
    await page.reload();
    await language.expectLanguage("tr");

    await language.chooseOnAuth("en");
    await language.expectLanguage("en");
  });

  test("the profile language is saved and persists across sign-out and a new device", async ({ pageAs, freshUser, isMobile }) => {
    const user = await freshUser({ language: "en" });
    const page = await pageAs(user);
    const profile = new ProfilePage(page);
    await profile.goto();
    await profile.language.expectLanguage("en");

    await profile.language.chooseOnProfile("tr");
    await expect(toastSuccess(page)).toBeVisible();
    await profile.language.expectLanguage("tr");
    await expect.poll(async () => (await getProfile(user.id))?.preferred_language).toBe("tr");

    // Same browser after sign-out: the saved choice is still applied on the sign-in page.
    await new Sidebar(page, !!isMobile).signOut();
    await new LanguageSwitcher(page).expectLanguage("tr");

    // New device with no saved local choice: the profile language wins after sign-in.
    const otherDevice = await pageAs(user, { language: null });
    await otherDevice.goto("/dashboard");
    await new DashboardPage(otherDevice).expectLoaded();
    await new LanguageSwitcher(otherDevice).expectLanguage("tr");
  });
});
