// How a task's assignees are named on rows and cards (Tasks page, meeting page, dashboard): the first assignee's
// full name (on phones "First L."), "+N" for the others, and "You" for the current user (always named first). Pure,
// so it is unit tested; the component (AssigneeNames) only renders it.

export type AssigneePerson = { id: string; full_name: string | null };

export type AssigneeLabel = {
  /** The first assignee: the full name (or "You"), and the short form for narrow screens. */
  full: string;
  short: string;
  /** How many more assignees ("+N"); 0 when there is one. */
  more: number;
  /** Every assignee's display name, the current user first ("You"): for the tooltip and screen readers. */
  names: string[];
  /** True when the first one shown is the current user. */
  you: boolean;
};

/** "Medway Manager" → "Medway M."; one word stays as it is ("Ömer"); extra spaces are ignored. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  const initial = Array.from(parts[parts.length - 1]!)[0] ?? "";
  return `${parts[0]} ${initial.toLocaleUpperCase()}.`;
}

/**
 * The label for a list of assignees, or null when there is none. `meId` is the signed-in user (null when unknown);
 * `you` and `formerMember` are the translated words for the current user and for a person without a name.
 */
export function assigneeLabel(
  people: readonly AssigneePerson[],
  opts: { meId: string | null | undefined; you: string; formerMember: string },
): AssigneeLabel | null {
  if (!people.length) return null;
  const me = opts.meId ? people.filter((p) => p.id === opts.meId) : [];
  const ordered = [...me.slice(0, 1), ...people.filter((p) => !me.includes(p))];
  const name = (p: AssigneePerson) => {
    if (opts.meId && p.id === opts.meId) return opts.you;
    const n = p.full_name?.trim();
    return n ? n : opts.formerMember;
  };
  const first = ordered[0]!;
  const you = !!opts.meId && first.id === opts.meId;
  const full = name(first);
  const hasName = !you && !!first.full_name?.trim();
  return {
    full,
    short: hasName ? shortName(full) : full,
    more: ordered.length - 1,
    names: ordered.map(name),
    you,
  };
}
