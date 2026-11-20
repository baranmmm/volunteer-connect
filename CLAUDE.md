@AGENTS.md

# Dialogue Society Volunteer Hub

Bilingual (EN/TR) volunteer hub for Dialogue Society branches, packaged as a PWA/native app.
TanStack Start + React 19 + Supabase, client-side SPA only (every route `ssr: false`).

**Lovable also edits this repo** (two-way sync on `main`). Pull before working, work on feature
branches, never force-push or rewrite pushed history, and keep `main` buildable.

## Roles
- `regional_director`: manages every branch in their region (region on `user_roles.region_id`). Only role
  that can change roles or move users between branches. Cannot be deleted in-app.
- `branch_manager`: manages volunteers in their own branch (approve/reject, activate/deactivate, delete).
- `volunteer`: own profile only. New sign-ups are `pending` volunteers until a manager approves them.

## Security rules
- RLS is enabled on every table. RLS and grants are the real enforcement; UI checks are convenience only.
- No direct client writes except the column-granted own-row fields `profiles.full_name`, `phone`, `preferred_language`.
- Every other change goes through SECURITY DEFINER RPCs: `set_user_status`, `set_user_role`, `set_user_branch`,
  `request_account_deletion`, `cancel_account_deletion`. History is read through `get_user_audit_history`.
- User deletion only through the `deleteUser` server function (`src/lib/delete-user.functions.ts`).
- The service_role key lives only in server code, e2e seed/teardown/API tests and GitHub secrets. Never in
  browser code and never in a `VITE_*` variable.
- Schema changes are made by Lovable. Never edit `supabase/migrations/`.

## i18n
No hardcoded user-facing strings. Every string is a key in both `src/locales/en.json` and `src/locales/tr.json`.
DB error messages map to keys through `ERROR_KEYS` in `src/lib/i18n.ts`.

## data-testid convention
kebab-case `page-element[-qualifier]` (e.g. `users-row-status-badge`, `user-details-delete-button`).
Never derived from visible or translated text. Lists expose record ids as `data-user-id` / `data-request-id`.
Toasts go through `src/lib/toast.ts` so they carry `toast-success` / `toast-error`.

## E2E tests (`e2e/`)
Separate npm package with Playwright + TypeScript page objects; see `e2e/README.md`.
- Runs only against the QA Supabase project `impdbvwsaancutwlrmac`; a guard aborts if the production ref
  `kcxmjscxooqqhsgrhknb` appears anywhere in the environment.
- Locators: `getByTestId` first, then `getByRole`. Never text locators (the UI is bilingual).
- First QA setup order: `npm run qa:migrate` → `npm run qa:seed` → `npm test` (run inside `e2e/`).
