// Server only: the language of the current request. The server renders the page in the cookie that mirrors the saved
// choice, else the Accept-Language header, and marks it on <html data-lang> so the hydrating client starts in the
// same language (src/lib/i18n.ts, which holds both locales everywhere).
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { isLang, LANG_COOKIE, type Lang } from "@/lib/i18n";

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
