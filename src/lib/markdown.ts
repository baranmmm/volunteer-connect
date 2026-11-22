/** Blocks of the small Markdown subset used by the privacy notice: headings, paragraphs, lists and tables. */
export type MdBlock =
  | { kind: "h1" | "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** Parses into plain-text blocks (no HTML is ever produced, so nothing in the text can inject markup). */
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", text: line.slice(2).trim() });
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith("|"); i++) rows.push(cells(lines[i]!));
      const [head = [], , ...body] = rows; // the second row is the --- separator
      blocks.push({ kind: "table", head, rows: body });
      continue;
    }
    if (line.startsWith("- ")) {
      const items: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith("- "); i++)
        items.push(lines[i]!.slice(2).trim());
      blocks.push({ kind: "ul", items });
      continue;
    }
    const text: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#|- |\|)/.test(lines[i]!); i++)
      text.push(lines[i]!.trim());
    blocks.push({ kind: "p", text: text.join(" ") });
  }
  return blocks;
}
