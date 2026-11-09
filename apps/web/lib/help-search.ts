import type { HelpGuide } from "../content/help-guides";

export type HelpSearchEntry = {
  href: string;
  title: string;
  section: string;
  category: string;
  text: string;
};

export function plainHelpText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The caller supplies curated published guides; this never reads the filesystem or user data. */
export function buildHelpSearchIndex(guides: HelpGuide[]): HelpSearchEntry[] {
  return guides.flatMap((guide) => [
    {
      href: `/help/${guide.slug}`,
      title: guide.title,
      section: "Overview",
      category: guide.category,
      text: guide.description,
    },
    ...guide.sections.map((section) => ({
      href: `/help/${guide.slug}#${section.id}`,
      title: guide.title,
      section: section.title,
      category: guide.category,
      text: plainHelpText(section.body),
    })),
  ]);
}

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export function searchHelp(
  entries: HelpSearchEntry[],
  query: string,
): HelpSearchEntry[] {
  const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries
    .map((entry) => {
      const title = normalize(entry.title);
      const heading = normalize(entry.section);
      const body = normalize(entry.text);
      if (
        !words.every((word) =>
          `${title} ${heading} ${body} ${normalize(entry.category)}`.includes(
            word,
          ),
        )
      )
        return { entry, score: 0 };
      const score = words.reduce(
        (sum, word) =>
          sum +
          (title.includes(word) ? 8 : 0) +
          (heading.includes(word) ? 5 : 0) +
          (body.includes(word) ? 1 : 0),
        1,
      );
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) => b.score - a.score || a.entry.href.localeCompare(b.entry.href),
    )
    .slice(0, 12)
    .map(({ entry }) => entry);
}

export function helpSearchSnippet(text: string, query: string): string {
  const first = normalize(query.trim()).split(/\s+/)[0] ?? "";
  const match = normalize(text).indexOf(first);
  const start = Math.max(0, match - 45);
  return `${start ? "…" : ""}${text.slice(start, start + 160)}${text.length > start + 160 ? "…" : ""}`;
}
