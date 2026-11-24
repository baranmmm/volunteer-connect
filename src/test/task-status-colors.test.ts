import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TASK_STATUSES } from "@/lib/tasks";
import {
  MINE_TINT,
  TASK_MINE,
  TASK_OTHER,
  TASK_OTHER_TEXT,
  TASK_STATUS_BADGE,
  TASK_STATUS_CARD,
  TASK_STATUS_COLUMN,
  TASK_STATUS_TINTS,
} from "@/components/tasks/task-status-colors";

// WCAG AA (4.5:1) for every text colour shown on a task status tint, in light and dark mode.

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
/** An oklch() theme colour as gamma-encoded sRGB (0..1). */
function oklch(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((x) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  }) as Rgb;
}
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
function token(name: string): Rgb {
  const m = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css);
  if (!m) throw new Error(`token --${name} not found`);
  return oklch(Number(m[1]), Number(m[2]), Number(m[3]));
}
/** `top` (with alpha 0..1) painted over `bottom`, as the browser composites in sRGB. */
const over = (top: Rgb, alpha: number, bottom: Rgb) =>
  top.map((v, i) => alpha * v + (1 - alpha) * bottom[i]!) as Rgb;
/** A #RRGGBBAA tint as colour and alpha. */
const hexA = (h: string): [Rgb, number] => [hex(h), parseInt(h.slice(7, 9), 16) / 255];
const theme = {
  foreground: token("foreground"),
  "muted-foreground": token("muted-foreground"),
  destructive: token("destructive"),
  primary: token("primary"),
};

describe("task status colours", () => {
  it("converts theme tokens like the browser (sanity check on a known colour)", () => {
    // --primary is the brand #006D9C.
    const [r, g, b] = theme.primary.map((v) => Math.round(v * 255));
    expect(Math.abs(r! - 0x00)).toBeLessThanOrEqual(2);
    expect(Math.abs(g! - 0x6d)).toBeLessThanOrEqual(2);
    expect(Math.abs(b! - 0x9c)).toBeLessThanOrEqual(2);
  });

  for (const mode of ["light", "dark"] as const)
    for (const status of TASK_STATUSES) {
      const tint = TASK_STATUS_TINTS[mode][status];
      it(`${mode} ${status}: badge, column and card text reach 4.5:1`, () => {
        expect(contrast(hex(tint.badgeFg), hex(tint.badgeBg))).toBeGreaterThanOrEqual(4.5);
        if (mode === "light")
          for (const [name, colour] of Object.entries(theme))
            for (const bg of [tint.column, tint.card])
              expect(contrast(colour, hex(bg)), `${name} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        // Dark mode: column and card text use the badge foreground.
        else
          for (const bg of [tint.column, tint.card])
            expect(contrast(hex(tint.badgeFg), hex(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }

  it("keeps the four statuses visually distinct", () => {
    for (const mode of ["light", "dark"] as const) {
      const tints = Object.values(TASK_STATUS_TINTS[mode]);
      for (const key of ["column", "card", "badgeBg"] as const)
        expect(new Set(tints.map((t) => t[key])).size).toBe(4);
    }
  });

  it("uses exactly these colours in the Tailwind classes", () => {
    for (const status of TASK_STATUSES) {
      const light = TASK_STATUS_TINTS.light[status];
      const dark = TASK_STATUS_TINTS.dark[status];
      expect(TASK_STATUS_BADGE[status]).toContain(`bg-[${light.badgeBg}]`);
      expect(TASK_STATUS_BADGE[status]).toContain(`text-[${light.badgeFg}]`);
      expect(TASK_STATUS_BADGE[status]).toContain(`border-[${light.badgeBorder}]`);
      expect(TASK_STATUS_BADGE[status]).toContain(`dark:bg-[${dark.badgeBg}]`);
      expect(TASK_STATUS_BADGE[status]).toContain(`dark:text-[${dark.badgeFg}]`);
      expect(TASK_STATUS_COLUMN[status]).toContain(`bg-[${light.column}]`);
      expect(TASK_STATUS_COLUMN[status]).toContain(`dark:bg-[${dark.column}]`);
      expect(TASK_STATUS_COLUMN[status]).toContain(`dark:text-[${dark.badgeFg}]`);
      expect(TASK_STATUS_CARD[status]).toContain(`bg-[${light.card}]`);
      expect(TASK_STATUS_CARD[status]).toContain(`dark:bg-[${dark.card}]`);
      expect(TASK_STATUS_CARD[status]).toContain(`dark:text-[${dark.badgeFg}]`);
    }
  });

  describe("mine and other people's tasks", () => {
    const card = token("card");
    const muted = token("muted");
    const [mineLight, mineLightAlpha] = hexA(MINE_TINT.light);
    const [mineDark, mineDarkAlpha] = hexA(MINE_TINT.dark);

    it("other people's tasks are quiet without opacity (opacity 0.75 took muted text below 4.5:1)", () => {
      for (const cls of [TASK_OTHER, TASK_OTHER_TEXT]) expect(cls).not.toMatch(/opacity/);
      expect(TASK_OTHER_TEXT).toContain("text-muted-foreground");
      expect(TASK_OTHER_TEXT).toContain("group-hover:text-foreground");
      expect(TASK_OTHER_TEXT).toContain("group-focus-within:text-foreground");
      expect(TASK_OTHER).toContain("group");
    });

    it("muted text on other people's cards, list rows and calendar items reaches 4.5:1 (also on hover)", () => {
      const surfaces: [string, Rgb][] = [
        ["card", card],
        ["list row hover (muted/60 on card)", over(muted, 0.6, card)],
        ["calendar item hover (muted)", muted],
        ...TASK_STATUSES.map((s): [string, Rgb] => [
          `${s} card`,
          hex(TASK_STATUS_TINTS.light[s].card),
        ]),
      ];
      for (const [name, bg] of surfaces)
        expect(contrast(theme["muted-foreground"], bg), name).toBeGreaterThanOrEqual(4.5);
    });

    it("every text colour on the mine tint reaches 4.5:1 (cards, list rows, calendar items)", () => {
      const light: [string, Rgb][] = [
        ["card", card],
        ...TASK_STATUSES.map((s): [string, Rgb] => [
          `${s} card`,
          hex(TASK_STATUS_TINTS.light[s].card),
        ]),
      ];
      for (const [name, bg] of light) {
        const tinted = over(mineLight, mineLightAlpha, bg);
        for (const [text, colour] of Object.entries(theme))
          expect(contrast(colour, tinted), `${text} on mine ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const s of TASK_STATUSES) {
        const tint = TASK_STATUS_TINTS.dark[s];
        const tinted = over(mineDark, mineDarkAlpha, hex(tint.card));
        expect(contrast(hex(tint.badgeFg), tinted), `dark ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("the mine classes use exactly the tint colours, with the accent border", () => {
      expect(TASK_MINE).toContain("border-l-4 border-l-primary");
      expect(TASK_MINE).toContain(`bg-[linear-gradient(${MINE_TINT.light},${MINE_TINT.light})]`);
      expect(TASK_MINE).toContain(`dark:bg-[linear-gradient(${MINE_TINT.dark},${MINE_TINT.dark})]`);
    });
  });
});
