import { parseMarkdown } from "@/lib/markdown";
import notice from "@/content/privacy-notice.md?raw";

const BLOCKS = parseMarkdown(notice);

/** The approved privacy notice (src/content/privacy-notice.md), rendered for /privacy and the confirmation screen. */
export function PrivacyNotice({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  return (
    <div
      data-testid="privacy-notice"
      lang="en"
      className="space-y-4 text-sm leading-relaxed sm:text-base"
    >
      {BLOCKS.map((b, i) => {
        if (b.kind === "h1")
          return headingLevel === 1 ? (
            <h1 key={i} className="text-2xl font-bold sm:text-3xl">
              {b.text}
            </h1>
          ) : (
            <h2 key={i} className="text-xl font-bold">
              {b.text}
            </h2>
          );
        if (b.kind === "h2")
          return headingLevel === 1 ? (
            <h2 key={i} className="pt-2 text-xl font-semibold">
              {b.text}
            </h2>
          ) : (
            <h3 key={i} className="pt-2 text-lg font-semibold">
              {b.text}
            </h3>
          );
        if (b.kind === "ul")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        if (b.kind === "table")
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th
                        key={j}
                        scope="col"
                        className="border-b bg-muted/50 px-3 py-2 font-semibold"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j} className="align-top">
                      {row.map((cell, k) =>
                        k === 0 ? (
                          <th key={k} scope="row" className="border-b px-3 py-2 font-medium">
                            {cell}
                          </th>
                        ) : (
                          <td key={k} className="border-b px-3 py-2">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return <p key={i}>{b.text}</p>;
      })}
    </div>
  );
}
