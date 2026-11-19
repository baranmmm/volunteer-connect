import { toast as sonner } from "sonner";

type Opts = Parameters<typeof sonner.success>[1];

// Wraps sonner so every success/error toast carries a stable data-testid for end-to-end tests.
export const toast = {
  success: (message: Parameters<typeof sonner.success>[0], opts?: Opts) => sonner.success(message, { testId: "toast-success", ...opts }),
  error: (message: Parameters<typeof sonner.error>[0], opts?: Opts) => sonner.error(message, { testId: "toast-error", ...opts }),
};
