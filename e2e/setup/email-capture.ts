// The e2e app server sends no real email: EMAIL_TRANSPORT=capture stores each rendered email on its outbox row
// (payload.captured), and tests read links from there (e2e/api/outbox.ts). Fixed, public test values: the signing
// secret and the cron secret exist only for the e2e app server (local stack or QA), never for production.
export const E2E_EMAIL_LINK_SECRET = "local-e2e-only-email-link-secret";
export const E2E_CLEANUP_CRON_SECRET_DEFAULT = "local-e2e-only-cron-secret";
/** The cron secret the e2e app server uses: CLEANUP_CRON_SECRET from the environment, else the fixed test value. */
export const e2eCronSecret = () => process.env["CLEANUP_CRON_SECRET"]?.trim() || E2E_CLEANUP_CRON_SECRET_DEFAULT;
