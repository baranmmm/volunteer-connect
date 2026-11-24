import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { useEffect, useMemo, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/components/ui/sonner";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n, {
  currentLang,
  LANGUAGE_COOKIE_SCRIPT,
  syncLanguageAfterHydration,
  type Lang,
} from "@/lib/i18n";
import { SESSION_MARK_SCRIPT } from "@/lib/supabase-lazy";

function NotFoundComponent() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="not-found-page"
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("common.notFoundTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.notFoundText")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div
      data-testid="error-page"
      className="flex min-h-screen items-center justify-center bg-background px-4"
    >
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {t("common.errorTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("common.errorText")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

/** The language to render in: on the server from the request (cookie, Accept-Language); in the browser the current one. */
const renderLanguage = createIsomorphicFn()
  .server(async (): Promise<Lang> => (await import("@/lib/i18n.server")).requestLanguage())
  .client(async (): Promise<Lang> => currentLang());

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async () => ({ lang: await renderLanguage() }),
  head: () => ({
    // Marks <html data-session> before the first paint when a stored session exists (no user data in it).
    // Reloads once in the saved language when the server rendered another one (no cookie yet; no user data in it).
    scripts: [{ children: LANGUAGE_COOKIE_SCRIPT }, { children: SESSION_MARK_SCRIPT }],
    // Replace these placeholders with the app's name and description when first building the app.
    // Each content route, / included, must still set its own head(). Never add og:image or
    // twitter:image here: every page without its own would inherit the root's preview image.
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dialogue Society Volunteer Hub" },
      {
        name: "description",
        content: "The volunteer hub for Dialogue Society branches across the UK.",
      },
      { name: "author", content: "Dialogue Society" },
      { name: "theme-color", content: "#0B3A52" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { property: "og:title", content: "Dialogue Society Volunteer Hub" },
      {
        property: "og:description",
        content: "The volunteer hub for Dialogue Society branches across the UK.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/brand/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/brand/favicon-48.png", type: "image/png", sizes: "48x48" },
      { rel: "icon", href: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/brand/favicon-16.png", type: "image/png", sizes: "16x16" },
      { rel: "icon", href: "/brand/favicon.ico", type: "image/x-icon" },
      {
        rel: "apple-touch-icon",
        href: "/brand/apple-touch-icon.png",
        type: "image/png",
        sizes: "180x180",
      },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      // Inter loads without blocking the first paint (see FONT_LOADER below); system fonts show until then.
      { rel: "preload", as: "style", href: INTER_CSS },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const INTER_CSS =
  "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap";
/** Adds the Inter stylesheet after parsing, so it never blocks rendering (a static string, no user data). */
const FONT_LOADER = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(INTER_CSS)};document.head.appendChild(l);})();`;

function RootShell({ children }: { children: ReactNode }) {
  const lang = Route.useLoaderData({ select: (data) => data?.lang }) ?? currentLang();
  // Server: one i18n instance per request, so concurrent requests in other languages never mix. Browser: the global
  // instance, which src/lib/i18n.ts started (both locales registered) in the language of <html data-lang>.
  const instance = useMemo(
    () => (typeof window === "undefined" ? i18n.cloneInstance({ lng: lang }) : i18n),
    [lang],
  );

  useEffect(() => {
    const updateLanguage = (language: string) => {
      document.documentElement.lang = language === "tr" ? "tr" : "en-GB";
    };
    updateLanguage(i18n.language);
    i18n.on("languageChanged", updateLanguage);
    // The server chose the language from the cookie or Accept-Language; switch if this browser's choice differs.
    syncLanguageAfterHydration();
    // Server-rendered pages are visible before they work: tests wait for this mark before they interact.
    document.documentElement.setAttribute("data-hydrated", "");
    return () => {
      i18n.off("languageChanged", updateLanguage);
    };
  }, []);

  return (
    <I18nextProvider i18n={instance}>
      <html lang={lang === "tr" ? "tr" : "en-GB"} data-lang={lang} suppressHydrationWarning>
        <head>
          <HeadContent />
          <script dangerouslySetInnerHTML={{ __html: FONT_LOADER }} />
          <noscript>
            <link rel="stylesheet" href={INTER_CSS} />
          </noscript>
        </head>
        <body>
          {children}
          <Scripts />
        </body>
      </html>
    </I18nextProvider>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AuthProvider>
        <Outlet />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
