import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { useSeen } from "./motion";

/**
 * A section that fades up when it scrolls into view. The motion lives in CSS (.ds-reveal) under
 * prefers-reduced-motion: no-preference, so with reduced motion the content is simply there.
 */
export function Reveal({ className, ...props }: ComponentPropsWithoutRef<"section">) {
  const [ref, seen] = useSeen<HTMLElement>();
  return (
    <section ref={ref} data-visible={seen} className={cn("ds-reveal", className)} {...props} />
  );
}
