<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Project rules
- All routes use `ssr: false` (client-side SPA) because the app will be packaged as a PWA/native app.
- Roles live only in `user_roles`; profile status changes go through the `set_user_status` RPC, and clients may update only `full_name`/`phone` (column grants), so RLS stays the real enforcement.
- Role and branch mutations use permission-checked database RPCs with atomic audit inserts; history names come from a scoped RPC so profile access is not widened.
- Account permissions refresh on page navigation and token refresh outside the synchronous auth listener to avoid Supabase auth deadlocks.
- User lists and history paginate before filtering or displaying to avoid silently missing members and last-manager warnings.
- User deletion runs in a requireSupabaseAuth server function: service-role-only authorization atomically writes the audit before auth deletion; requests link to that audit so completion or failure updates only that attempt. Failures write a personal-data-free audit and restore pending requests. Edge Functions are not used; future user-referencing tables use ON DELETE SET NULL.
- UI text lives only in src/locales/{en,tr}.json via react-i18next (src/lib/i18n.ts); DB error messages map to keys there and history renders from audit rows, so translations never depend on stored sentences.
- E2E selectors use stable kebab-case data-testid attributes (never derived from text); toasts must use src/lib/toast.ts so they carry toast-success/toast-error ids.
- Event reads and mutations use authenticated server functions and user-scoped RPCs; event RLS checks active status and branch/region membership so UI permissions are not authoritative.
- Event media reserves a slot through an RPC before private Storage upload; event-row locks enforce the five-file cap, Storage deletion precedes record deletion, and signed URLs expire after five minutes.
- Event input uses date-fns-tz for Europe/London conversion and browser canvas re-encoding for image resize/EXIF removal, avoiding browser-zone shifts and metadata leaks.
- Event uploads normalize JPEG extensions in the client/server and reservation RPC; bucket MIME/size limits enforce file rules, while upload RLS checks only bucket, reserved path permission and extension because pre-upload metadata is empty.
- Event deletion soft-deletes via authenticated RPCs and archives private files through the Storage API; durable archive/restore/purge jobs prevent conflicting operations, and recovery uses a separate region-scoped RPC so ordinary event reads never expose deleted rows. Previously cached/downloaded media cannot be revoked.
- Permanent cleanup runs through a secret-authenticated public server route and GitHub Actions, with service-only purge RPCs and count-only run audits; always delete files through Storage before rows, never mutate Storage objects with SQL.
- Registration integration must lock the event row before writes and reject deleted events or event_deletion_jobs; purge must not delete unrelated registration rows, so future foreign keys must be designed for event retention explicitly.
- Event drafts support unset dates with explicit unscheduled display; publishing validation lives in shared form rules, server input validation, and the database trigger so title-only drafts never need fabricated dates.
