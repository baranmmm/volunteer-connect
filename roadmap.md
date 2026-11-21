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
