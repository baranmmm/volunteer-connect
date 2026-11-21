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
