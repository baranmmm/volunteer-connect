// Client entry (replaces TanStack Start's default): loads the page's locale file first (preloaded by the page head),
// then hydrates, so the first client render shows the same text as the server-rendered HTML.
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { i18nReady } from "@/lib/i18n";

void i18nReady().finally(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    );
  });
});
