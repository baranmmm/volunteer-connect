# App-wide Recycle Bin
- [ ] Replace Calendar recovery with a manager-only Recycle Bin for events and users, scoped in the database.
- [ ] Integrate soft user deletion, immediate access blocking, restoration and non-restorable self-requested erasure.
- [ ] Add simple deletion confirmations, typed permanent deletion and audited multi-type daily cleanup.
- [ ] Run permission, retention, orchestration and UI tests; signed-in live verification requires an external session.

# Calendar ongoing events
- [x] Include ongoing events in Upcoming and show bilingual Happening now badges; move to Past after end.
- [x] Month ignores List time toggle; compare timestamps in UTC and date-only events in Europe/London.
- [x] 147 regression tests passed; calendar tests also passed in Los Angeles/Tokyo time zones. Real components displayed EN/TR badges and removed them after end.
- [ ] Signed-in calendar verification: external Supabase has no managed session; preview redirects to /auth. No all-day field currently exists; shared rules support date-only/London-day input without schema changes.

# Soft deletion and recovery
- [x] Event form: publish-required markers, title-only drafts, enabled save buttons, inline errors and scroll to first invalid field.
- [x] Hide soft-deleted events and media; archive files to invalidate old paths (live Storage link 200 → 400, restored).
- [x] Regional Director recovery within 30 days, title confirmation, and audit logging.
- [x] Daily GitHub Actions purge at 03:30 UTC: constant-time CLEANUP_CRON_SECRET check, bounded batches, count-only response, per-run audit, concurrency, manual dispatch.
- [ ] Configure CLEANUP_CRON_SECRET in Lovable and GitHub; publish production endpoint (user-supplied secret).
- [x] Database, file orchestration, form and UI regressions passed; live cleanup rejects wrong secret with empty 401.
- [ ] Full signed-in deletion/recovery preview checks: external Supabase has no managed session; preview opens /auth.

# Delete event
- [x] Add server-enforced deletion eligibility, durable cleanup coordination, and retained event audit entries.
- [x] Add bilingual confirmation and manager-only actions; isolated database, Storage orchestration, and UI permission tests pass.
- [ ] Verify live deletion and storage readback: external unmanaged Supabase has no authenticated test session; live preview redirects to /auth.

# Event upload repair
- [x] Normalize JPEG paths and remove premature upload metadata checks without changing other permissions.
- [x] Enforce bucket MIME types and 10 MB limit; show per-file rejection reasons and preserve cleanup.
- [x] Run regressions (96 passed), real browser image preparation and actual bucket TXT / oversized rejection checks.
- [ ] Verify real Branch Manager upload / Volunteer readback: external Supabase has no managed browser sessions; live preview redirects to sign-in.

# Role management
- [x] Simplify Users rows and group details actions without changing Approvals.
- [x] Log deletion before account removal and record failures safely; 39 tests and simulated desktop/mobile checks passed.
- [x] Add guarded role/branch changes and immutable audit history.
- [x] Add Users filters, confirmation dialogs, and history panel.
- [x] Refresh account permissions on navigation and token refresh.
- [x] Test permission rules in isolated PostgreSQL and simulated desktop/mobile UI; report definitions and grants.
- [ ] Verify with a real signed-in account: external Supabase does not support managed test sessions here.
# Language support
- [x] English/Turkish UI, saved language on profile, switchers; 45 tests and simulated desktop/mobile checks passed.

# Test ids
- [x] Stable data-testid attributes across pages, dialogs and toasts.
- [x] Add the requested supplemental test ids and verify them without behaviour, styling, text or database changes.

# Hydration
- [x] Keep the root HTML language stable during SSR and synchronize it after hydration.

# Calendar & Events
- [x] Secure event and media tables, RPCs, and private storage.
- [x] Calendar/list filters, creation/editing, details/gallery and calendar sharing in EN/TR.
- [x] Test access rules, file limits and London times; provide SQL and test-id report (84 tests and simulated desktop/phone flows passed).
- [ ] Verify real signed-in creation and file readback (external account required).

# Dialogue Society brand
- [x] Apply brand colour tokens and accessible action/sidebar colours.
- [x] Add official full and square logos to desktop and mobile layouts.
- [x] Update favicon, Apple touch icon, and PWA icons; verify desktop/mobile presentation.

# Follow-up visual changes
- [x] Use a frosted blue-mark logo tile on navy, with brand text on desktop only.
- [x] Generate SVG/PNG favicon and install icons from the speech-bubble mark.
- [x] Apply Apple-style system typography with Inter latin-ext fallback and verify rendering.

# Glossy app-icon treatment
- [x] Replace the sidebar frosted tile with the glossy gradient tile and crisp blue mark.
- [x] Regenerate matching SVG/PNG browser, Apple, and PWA icons and verify desktop/mobile rendering.

# Final brand assets
- [x] Save the supplied logo and icon files in public/brand and use them in the sidebar, favicon, Apple touch icon and PWA manifest.
- [x] Remove the CSS tile, gloss, gradient, border and glow treatment now that the glow is part of the artwork; verify desktop and phone rendering.
- [x] Replace only the browser favicon with the supplied glossy set (svg, 48/32/16 png, ico) and keep the sidebar, Apple and PWA icons unchanged.

# Inter typography
- [x] Make Inter the primary font with the variable-font load (wght 400..700, latin-ext, font-display swap).
- [x] Apply the Notion-style hierarchy: titles 700 at -0.02em, section headings 600, body 400 at 16px/1.5, labels and menu items 500; verify English and Turkish rendering.
