import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// Each locale is a separate static file: the browser downloads only the language it shows, before hydrating
// (src/client.tsx; the page head preloads it). The server adds both bundles (i18n.server.ts), tests in setup.ts.
import enUrl from "@/locales/en.json?url";
import trUrl from "@/locales/tr.json?url";

export type Lang = "en" | "tr";
export const LANG_STORAGE_KEY = "dsvh-language";
/** Mirrors the saved choice for the server, which renders the public pages in that language. */
export const LANG_COOKIE = "dsvh-language";
export const LOCALE_URLS: Record<Lang, string> = { en: enUrl, tr: trUrl };

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "tr";
}

function savedLanguage(): Lang | null {
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null; // storage unavailable
  }
}

/** Before sign-in: saved choice, then browser language (Turkish if it starts with "tr"), else English. */
export function detectLanguage(): Lang {
  if (typeof window === "undefined") return "en";
  return (
    savedLanguage() ?? ((navigator.language || "").toLowerCase().startsWith("tr") ? "tr" : "en")
  );
}

/** The language the server rendered this page in (`<html data-lang>`), so hydration renders the same text. */
function pageLanguage(): Lang | null {
  if (typeof document === "undefined") return null;
  const lang = document.documentElement.getAttribute("data-lang");
  return isLang(lang) ? lang : null;
}

void i18n.use(initReactI18next).init({
  resources: {},
  partialBundledLanguages: true,
  lng: pageLanguage() ?? detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

function applyHtmlLang(lang: Lang) {
  if (typeof document !== "undefined")
    document.documentElement.lang = lang === "tr" ? "tr" : "en-GB";
}
applyHtmlLang(currentLang());
i18n.on("languageChanged", (l) => applyHtmlLang(isLang(l) ? l : "en"));

export function currentLang(): Lang {
  return isLang(i18n.language) ? i18n.language : "en";
}

const loading: Partial<Record<Lang, Promise<void>>> = {};
/** Downloads one locale once (nothing to do when it is already loaded: on the server and in tests). */
export function loadLanguage(lang: Lang): Promise<void> {
  if (i18n.hasResourceBundle(lang, "translation")) return Promise.resolve();
  loading[lang] ??= fetch(LOCALE_URLS[lang], { credentials: "same-origin" })
    .then((res) => {
      if (!res.ok) throw new Error(`locale ${lang}`);
      return res.json() as Promise<Record<string, unknown>>;
    })
    .then((bundle) => {
      i18n.addResourceBundle(lang, "translation", bundle, true, true);
    })
    .catch((error: unknown) => {
      delete loading[lang];
      throw error;
    });
  return loading[lang];
}

/** Resolves once the current language's texts are loaded (the client waits for it before hydrating). */
export function i18nReady(): Promise<void> {
  return loadLanguage(currentLang()).catch(() =>
    // Without its own file the page still works in English.
    loadLanguage("en").then(() => void i18n.changeLanguage("en")),
  );
}

function writeLanguageCookie(lang: Lang) {
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* ignore */
  }
}

function switchLanguage(lang: Lang) {
  if (i18n.language === lang) return;
  // Synchronous when the texts are already loaded (always on the server and in tests).
  if (i18n.hasResourceBundle(lang, "translation")) void i18n.changeLanguage(lang);
  else
    void loadLanguage(lang).then(
      () => i18n.changeLanguage(lang),
      () => undefined,
    );
}

/**
 * After hydration: switch to the visitor's own choice when the server guessed differently (no cookie yet), and keep
 * the cookie in step with a saved choice so the next server render uses it.
 */
export function syncLanguageAfterHydration() {
  const saved = savedLanguage();
  if (saved) writeLanguageCookie(saved);
  switchLanguage(detectLanguage());
}

export function setLanguage(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  writeLanguageCookie(lang);
  switchLanguage(lang);
}

export function dateLocale(lang: string = i18n.language) {
  return lang === "tr" ? "tr-TR" : "en-GB";
}

export function formatDate(
  value: string | Date,
  opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  return new Intl.DateTimeFormat(dateLocale(), { timeZone: "Europe/London", ...opts }).format(
    new Date(value),
  );
}

const ERROR_KEYS: Record<string, string> = {
  "Choose a branch to follow": "errors.chooseFollowBranch",
  "Only followers can apply to volunteer": "errors.notFollower",
  "You already have an open application": "errors.openApplication",
  "This application is no longer open": "errors.applicationClosed",
  "Tell us how you would like to help (30 to 500 characters)": "errors.volunteerHelp",
  "Choose how much time you can give": "errors.volunteerTime",
  "Please confirm the volunteering commitment": "errors.volunteerCommitment",
  "Invalid volunteer application": "errors.volunteerInvalid",
  "The applicant is no longer a follower": "errors.applicantChanged",
  "Decline reason must be at least 10 characters": "errors.declineShort",
  "Follow at least one branch": "errors.followOne",
  "Branch not found": "errors.branchNotFound",
  "Region not found": "errors.regionNotFound",
  "Only members can request events": "errors.membersOnlyRequests",
  "Registrant details are not available": "errors.noRegistrantDetails",
  "This role cannot be assigned in the app": "errors.roleNotAssignable",
  "Choose a region": "errors.chooseRegion",
  "Assign a branch first": "errors.assignBranchFirst",
  "The last active National Coordinator cannot be removed": "errors.lastNc",
  "National Coordinators cannot be deleted in the app": "errors.ncCannotBeDeleted",
  "Followers delete their account directly": "errors.followersDeleteDirectly",
  "Two-factor authentication required": "errors.mfaRequired",
  "The name does not match": "errors.nameMismatch",
  "This branch still has active users": "errors.branchInUse",
  "This branch still has upcoming events": "errors.branchHasEvents",
  "This region still has active users": "errors.regionInUse",
  "This region still has upcoming events": "errors.regionHasEvents",
  "Restore the region first": "errors.restoreRegionFirst",
  "This item has history and stays archived": "errors.structureHistory",
  "A region with this name already exists": "errors.regionExists",
  "A branch with this name already exists": "errors.branchExists",
  "Name must be 2 to 80 characters": "errors.nameLength",
  "Date range must be at most 12 months": "errors.dateRange",
  "Invalid recurrence rule": "events.repeat.invalidRule",
  "Regional directors create events directly": "requests.errors.directorsCreate",
  "Branch managers create branch events directly": "requests.errors.managersCreateBranch",
  "Too many open requests": "requests.errors.tooMany",
  "Request title is required": "requests.errors.titleRequired",
  "Proposed date is required": "requests.errors.dateRequired",
  "Proposed date must be in the future": "requests.errors.future",
  "Invalid request values": "requests.errors.invalid",
  "Request can no longer be changed": "requests.errors.locked",
  "Request already decided": "requests.errors.decided",
  "Request already under review": "requests.errors.underReview",
  "Decline reason is required": "requests.errors.declineReason",
  "You cannot review your own request": "requests.errors.ownReview",
  "Request not found": "requests.errors.notFound",
  "Privacy notice must be accepted": "privacy.errors.mustAccept",
  "Privacy notice version is out of date": "privacy.errors.outdated",
  "Privacy notice not accepted": "privacy.errors.notAccepted",
  "Invalid consent values": "privacy.errors.invalidConsent",
  "Organiser is required": "requests.errors.organizer",
  "Invalid request source": "requests.errors.source",
  "Source link must use https": "requests.errors.sourceUrl",
  "Maximum 3 files per request": "requests.errors.tooManyFiles",
  "Invalid request file": "requests.errors.invalidFile",
  "Request scope and type cannot be changed": "requests.errors.scopeType",
  "Request files could not be loaded": "requests.errors.filesLoad",
  "Registration is closed": "registrations.errors.closed",
  "Event has ended": "registrations.errors.ended",
  "Event has started": "registrations.errors.started",
  "Event has not started": "registrations.errors.notStarted",
  "Registration not found": "registrations.errors.notFound",
  "Invalid number of places": "guest.errors.places",
  "Invalid guest details": "guest.errors.details",
  "Link is no longer valid": "guest.errors.link",
  "Invalid subscriber details": "subscribe.errors.details",
  "Verification failed": "guest.errors.verification",
  "Public forms unavailable": "guest.errors.unavailable",
  "Invalid attendance status": "registrations.errors.invalidAttendance",
  "Recurrence has no upcoming events": "events.repeat.noUpcoming",
  "Item cannot be restored": "recycleBin.restoreUnavailable",
  "Item cannot be purged": "recycleBin.purgeUnavailable",
  "Account restoration failed": "recycleBin.restoreFailed",
  "Account erasure failed": "recycleBin.purgeFailed",
  "Permanent deletion confirmation required": "recycleBin.typeDelete",
  "User is banned": "recycleBin.accountDeleted",
  "Event title confirmation required": "events.titleMismatch",
  "Event cannot be restored": "events.restoreUnavailable",
  "Event restoration files missing": "events.restoreFilesMissing",
  "Required publish fields missing": "events.requiredNote",
  "Event cannot be deleted": "events.deleteUnavailable",
  "Event deletion cleanup failed": "events.deleteCleanupFailed",
  "Event files still exist": "events.deleteCleanupFailed",
  "Event deletion not prepared": "events.deleteCleanupFailed",
  "Event title and organizer are required": "events.required",
  "Invalid event values": "events.invalid",
  "Invalid event dates or capacity": "events.invalid",
  "Invalid event scope": "events.invalid",
  "Event end must be after start": "events.dateError",
  "Published event cannot end in the past": "events.pastPublishError",
  "Online meeting link must use https": "events.onlineUrlError",
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
  "Task not found": "errors.workTaskNotFound",
  "Meeting not found": "errors.workMeetingNotFound",
  "This person cannot be assigned": "errors.workCannotAssign",
  "This person cannot receive your request": "errors.workCannotRequest",
  "Title is required": "errors.workTitleRequired",
  "Reminder settings are not valid": "errors.workReminders",
  "Linked event must be in the same scope": "errors.workEventScope",
  "End must be after start": "errors.workEndAfterStart",
  "Online link must start with https://": "errors.workOnlineUrl",
  "Location is required": "errors.workLocation",
  "Invitee is not in this scope": "errors.workInviteeScope",
  "Too many invitees": "errors.workTooManyInvitees",
  "Too many assignees": "errors.workTooManyAssignees",
  "Too many agenda items": "errors.workTooManyItems",
  "Decision text is required": "errors.workDecisionText",
  "File type is not allowed": "errors.workFileType",
  "Too many files": "errors.workTooManyFiles",
  "Decline reason is too short": "errors.declineShort",
  "Meeting files still exist": "errors.workMeetingFiles",
  "Meeting deletion cleanup failed": "errors.workMeetingFiles",
  // Tasks + Meetings v2
  "Only done tasks can be archived": "errors.taskArchiveNotDone",
  "Note text is required": "errors.taskNoteRequired",
  "Too many notes": "errors.taskNoteTooMany",
  "Too many mentions": "errors.taskNoteTooManyMentions",
  "This person cannot see the task": "errors.taskNoteMentionHidden",
  "Too many tasks": "errors.taskTooMany",
  "Choose at least one person": "errors.taskChooseAssignee",
  "Repeat settings are not valid": "errors.meetingRepeatInvalid",
  "A recurring meeting can span at most 12 months": "errors.meetingRepeatTooLong",
  "Agenda items are not valid": "errors.meetingAgendaInvalid",
  "Not a recurring meeting": "errors.meetingNotRecurring",
  "Delete the meeting instead": "errors.meetingDeleteThroughMeeting",
  "The category of a meeting cannot change": "errors.meetingCategoryFixed",
  "Add files on the meeting page": "errors.meetingFilesOnMeeting",
  "Recurring meetings are created from the meeting form": "errors.meetingRepeatFromMeetingForm",
  "This notice cannot be changed": "errors.notificationLocked",
  // Public events v2: managers (cover image, past events, gallery, videos, announcements).
  "Public events need a cover image": "events.coverRequired",
  "Past event date must be in the past": "pastEvents.dateError",
  "Past events are edited from the past event form": "pastEvents.notEditable",
  "Maximum 12 photos per past event": "pastEvents.tooManyPhotos",
  "Only photos of public events can be shown in the gallery": "pastEvents.galleryOnlyPublic",
  "Videos can be added to public events only": "pastEvents.videosPublicOnly",
  "Invalid YouTube link": "pastEvents.invalidYoutube",
  "Maximum 6 videos per event": "pastEvents.tooManyVideos",
  "This video is already added": "pastEvents.duplicateVideo",
  "Only upcoming public events can be announced": "announce.onlyUpcoming",
  "Current password is incorrect": "profile.password.errors.currentWrong",
  "New password should be different from the old password.": "errors.passwordSame",
  "New password should be different from the old password": "errors.passwordSame",
  "Password update requires reauthentication.": "errors.passwordReauth",
  "Password update requires reauthentication": "errors.passwordReauth",
  "Not allowed": "errors.notAllowed",
  "Enter a valid UK postcode": "errors.postcodeInvalid",
  "Not signed in": "errors.notSignedIn",
  "Only active Regional Directors can change roles": "errors.directorOnlyRoles",
  "Only active Regional Directors can move users": "errors.directorOnlyMove",
  "Profile not found": "errors.profileNotFound",
  "Regional Directors cannot be deleted": "errors.directorCannotBeDeleted",
  "Regional Directors must contact the Dialogue Society office to delete their account":
    "errors.directorSelfDelete",
  "Role must be Volunteer or Branch Manager; Regional Director cannot be assigned":
    "errors.invalidRole",
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
  "The account could not be deleted. The failed attempt was recorded; any related deletion request remains pending. Please try again.":
    "errors.deleteFailedRecorded",
  "The account could not be deleted, and the failed attempt could not be recorded. Please try again.":
    "errors.deleteFailedUnrecorded",
  "The account was deleted and its history was saved, but the deletion request could not be marked completed.":
    "errors.deleteRequestNotCompleted",
  "Invalid login credentials": "errors.invalidLogin",
  "Email not confirmed": "errors.emailNotConfirmed",
  "User already registered": "errors.userExists",
};

/** Map known server/database messages to translation keys; anything else becomes a generic error. */
export function errorKey(e: unknown): string {
  const msg =
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : typeof e === "string"
        ? e
        : "";
  if (ERROR_KEYS[msg]) return ERROR_KEYS[msg];
  if (/password/i.test(msg) && /(weak|short|least|characters)/i.test(msg))
    return "errors.weakPassword";
  return "errors.generic";
}

export function translateError(e: unknown) {
  return i18n.t(errorKey(e));
}

export default i18n;
