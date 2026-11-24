// Server only: both locales for server rendering, and the language of the current request. The browser downloads
// only its own locale (src/lib/i18n.ts); the server picks the same one from the cookie that mirrors the saved choice,
// else the Accept-Language header, so the hydrating client renders the same text.
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import i18n, { isLang, LANG_COOKIE, type Lang } from "@/lib/i18n";

for (const [lang, bundle] of [
  ["en", en],
  ["tr", tr],
] as const) {
  if (!i18n.hasResourceBundle(lang, "translation"))
    i18n.addResourceBundle(lang, "translation", bundle, true, true);
}

/** Cookie (the visitor's saved choice), then the first Accept-Language entry (Turkish if it starts with "tr"). */
export function requestLanguage(): Lang {
  try {
    const saved = getCookie(LANG_COOKIE);
    if (isLang(saved)) return saved;
    const first = (getRequestHeader("accept-language") ?? "").split(",")[0] ?? "";
    return first.trim().toLowerCase().startsWith("tr") ? "tr" : "en";
  } catch {
    return "en"; // outside a request
  }
}
