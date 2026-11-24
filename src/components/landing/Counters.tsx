import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateLocale } from "@/lib/i18n";
import type { LandingData } from "@/lib/landing.server";
import { prefersReducedMotion, useSeen } from "./motion";

const KEYS = ["events_held", "registrations", "branches"] as const;
const DURATION = 1400;

function Counter({ name, value }: { name: (typeof KEYS)[number]; value: number }) {
  const { t, i18n } = useTranslation();
  const [ref, seen] = useSeen<HTMLLIElement>("0px");
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (!seen) return;
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    let frame = 0;
    const begin = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - begin) / DURATION);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, value]);
  const format = (n: number) => new Intl.NumberFormat(dateLocale(i18n.language)).format(n);
  return (
    <li
      ref={ref}
      data-testid="landing-counter"
      data-counter={name}
      data-value={value}
      className="text-center"
    >
      {/* The animated number is decoration; screen readers get the final figure once. */}
      <span aria-hidden className="block text-4xl font-bold tabular-nums sm:text-5xl">
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)} </span>
      <span className="mt-1 block text-sm font-medium uppercase tracking-wide text-white/85">
        {t(`landing.stats.${name}`, { count: value })}
      </span>
    </li>
  );
}

/** Counts from real data; a figure of zero is left out (and the band too when all are zero). */
export function Counters({ stats }: { stats: LandingData["stats"] }) {
  const { t } = useTranslation();
  const items = KEYS.filter((k) => stats[k] > 0);
  if (!items.length) return null;
  return (
    <section aria-label={t("landing.stats.label")} className="bg-[#28303D] text-white">
      <ul className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-16 gap-y-8 px-4 py-12 sm:px-6">
        {items.map((k) => (
          <Counter key={k} name={k} value={stats[k]} />
        ))}
      </ul>
    </section>
  );
}
