import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";

export type Lang = "en" | "tr";
export const LANG_STORAGE_KEY = "dsvh-language";

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "tr";
}

/** Before sign-in: saved choice, then browser language (Turkish if it starts with "tr"), else English. */
export function detectLanguage(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, tr: { translation: tr } },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

function applyHtmlLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang === "tr" ? "tr" : "en-GB";
}
applyHtmlLang(currentLang());
i18n.on("languageChanged", (l) => applyHtmlLang(isLang(l) ? l : "en"));

export function currentLang(): Lang {
  return isLang(i18n.language) ? i18n.language : "en";
}

export function setLanguage(lang: Lang) {
  try { window.localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* ignore */ }
  if (i18n.language !== lang) void i18n.changeLanguage(lang);
  applyHtmlLang(lang);
}

export function dateLocale(lang: string = i18n.language) {
  return lang === "tr" ? "tr-TR" : "en-GB";
}

export function formatDate(value: string | Date, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(dateLocale(), { timeZone: "Europe/London", ...opts }).format(new Date(value));
}

const ERROR_KEYS: Record<string, string> = {
  "Event title and organizer are required": "events.required",
  "Invalid event values": "events.invalid",
  "Invalid event dates or capacity": "events.invalid",
  "Invalid event scope": "events.invalid",
  "Invalid event file": "events.fileError",
  "Maximum 5 files per event": "events.tooManyFiles",
  "Event file exceeds 10 MB": "events.fileTooLarge",
  "Event file upload failed": "events.fileUploadFailed",
  "Invalid event file order": "events.orderError",
  "Cover must be an image": "events.orderError",
  "Remove stored file first": "events.removeFirst",
  "Invalid London time": "events.timeError",
  "Deactivate the user first": "errors.deactivateFirst",
  "Invalid deletion audit entry": "errors.generic",
  "No pending deletion request": "errors.noPendingRequest",
  "Not allowed": "errors.notAllowed",
  "Not signed in": "errors.notSignedIn",
  "Only active Regional Directors can change roles": "errors.directorOnlyRoles",
  "Only active Regional Directors can move users": "errors.directorOnlyMove",
  "Profile not found": "errors.profileNotFound",
  "Regional Directors cannot be deleted": "errors.directorCannotBeDeleted",
  "Regional Directors must contact the Dialogue Society office to delete their account": "errors.directorSelfDelete",
  "Role must be Volunteer or Branch Manager; Regional Director cannot be assigned": "errors.invalidRole",
  "The new branch must belong to your region": "errors.branchOutsideRegion",
  "This deletion request is no longer pending": "errors.requestNotPending",
  "User not found": "errors.userNotFound",
  "You already have a pending deletion request": "errors.alreadyRequested",
  "You cannot change your own role": "errors.ownRole",
  "You cannot change your own status": "errors.ownStatus",
  "You cannot delete your own account here": "errors.ownDelete",
  "You cannot manage this user": "errors.cannotManage",
  "You cannot move your own branch": "errors.ownBranch",
  "Deletion could not be logged. The account has not been deleted.": "errors.deleteNotLogged",
  "The account could not be deleted. The failed attempt was recorded; any related deletion request remains pending. Please try again.": "errors.deleteFailedRecorded",
  "The account could not be deleted, and the failed attempt could not be recorded. Please try again.": "errors.deleteFailedUnrecorded",
  "The account was deleted and its history was saved, but the deletion request could not be marked completed.": "errors.deleteRequestNotCompleted",
  "Invalid login credentials": "errors.invalidLogin",
  "Email not confirmed": "errors.emailNotConfirmed",
  "User already registered": "errors.userExists",
};

/** Map known server/database messages to translation keys; anything else becomes a generic error. */
export function errorKey(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : typeof e === "string" ? e : "";
  if (ERROR_KEYS[msg]) return ERROR_KEYS[msg];
  if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg)) return "errors.weakPassword";
  return "errors.generic";
}

export function translateError(e: unknown) {
  return i18n.t(errorKey(e));
}

export default i18n;
