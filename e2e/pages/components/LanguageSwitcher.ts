import { expect, type Page } from "@playwright/test";
import { pickOption } from "./select";

export type Lang = "en" | "tr";
const HTML_LANG: Record<Lang, string> = { en: "en-GB", tr: "tr" };

export class LanguageSwitcher {
  constructor(private readonly page: Page) {}

  /** EN | TR toggle on the auth and reset-password pages. */
  toggle(lang: Lang) {
    return this.page.getByTestId(`auth-language-toggle-${lang}`);
  }
  async chooseOnAuth(lang: Lang) {
    await this.toggle(lang).click();
    await expect(this.toggle(lang)).toHaveAttribute("aria-pressed", "true");
  }

  /** Profile page select (options: en, tr). */
  async chooseOnProfile(lang: Lang) {
    await pickOption(this.page, "profile-language-select", "profile-language-option", lang, lang === "en" ? 0 : 1);
  }

  /** The app mirrors the active language on <html lang>, which is language-neutral to assert. */
  async expectLanguage(lang: Lang) {
    await expect(this.page.locator("html")).toHaveAttribute("lang", HTML_LANG[lang]);
  }
}
