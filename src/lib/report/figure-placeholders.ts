/** Shared by browser rendering and server export; no AI or server dependencies. */
export function normalizeFigureKey(title: string): string {
  return title.trim().toLowerCase()
    .replace(/^(?:gambar|figure)\s+\d+(?:\.\d+)*[.:]?\s*[:\-]?\s*/i, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ").trim();
}

export interface FigureAsset {
  title: string;
  caption?: string;
  sectionId?: string;
  /** Unavailable assets are matched, but never inserted automatically. */
  available?: boolean;
}

export interface FigureOutlineSection { id?: string; title: string }

export function parseFigurePlaceholder(line: string, knownTitles: readonly string[] = []) {
  const match = /^\s*(?:\d+[.)]\s+)?\[Gambar:\s*([^\]]+)\][ \t]*(.*)$/i.exec(line);
  if (!match) return null;
  const inner = match[1].trim();
  const separators = Array.from(inner.matchAll(/\s+[-\u2013\u2014]\s+/g));
  const candidates = [
    { title: inner, caption: "" },
    ...separators.map((sep) => ({ title: inner.slice(0, sep.index).trim(), caption: inner.slice(sep.index! + sep[0].length).trim() })),
  ];
  // A known full title wins over a shorter prefix, even if both contain " - ".
  const known = new Map(knownTitles.map((title) => [normalizeFigureKey(title), title]));
  const resolved = candidates.filter((candidate) => known.has(normalizeFigureKey(candidate.title)))
    .sort((a, b) => normalizeFigureKey(b.title).length - normalizeFigureKey(a.title).length)[0];
  const picked = resolved || candidates[candidates.length - 1];
  const title = resolved ? known.get(normalizeFigureKey(picked.title))! : picked.title;
  return { title, key: normalizeFigureKey(title), caption: picked.caption, trailing: match[2].trim() };
}

/** Only real placeholder lines, not examples inside fenced code blocks. */
export function figurePlaceholders(markdown: string, knownTitles: readonly string[] = []) {
  let fenced = false;
  return markdown.replace(/\r/g, "").split("\n").flatMap((line, index) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return []; }
    const figure = !fenced ? parseFigurePlaceholder(line, knownTitles) : null;
    return figure ? [{ ...figure, line: index }] : [];
  });
}

const headingKey = (title: string) => normalizeFigureKey(title.replace(/\*\*/g, "")
  .replace(/^bab\s+(?:[ivxlc]+|\d+)\b\s*[:.\-\u2013\u2014]?\s*/i, "")
  .replace(/^\d+(?:\.\d+)*\.?\s+/, ""));

/** Restore omitted known assets once, at their section's end or before references. */
export function reconcileFigurePlaceholders(markdown: string, assets: readonly FigureAsset[], outline: readonly FigureOutlineSection[] = []) {
  const unique = new Map<string, FigureAsset>();
  for (const asset of assets) {
    const key = normalizeFigureKey(asset.title);
    if (key && !unique.has(key)) unique.set(key, asset);
  }
  const titles = [...unique.values()].map((asset) => asset.title);
  const seen = new Set<string>();
  const lines = markdown.replace(/\r/g, "").split("\n");
  for (const figure of figurePlaceholders(markdown, titles)) {
    if (!unique.has(figure.key)) continue;
    if (seen.has(figure.key)) lines[figure.line] = figure.trailing;
    seen.add(figure.key);
  }
  const headings: Array<{ line: number; level: number; title: string }> = [];
  let fenced = false;
  lines.forEach((line, index) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    const heading = !fenced && /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) headings.push({ line: index, level: heading[1].length, title: heading[2] });
  });
  const bibliography = headings.find((heading) => /^(daftar pustaka|referensi|references|bibliograf)/i.test(headingKey(heading.title)))?.line ?? lines.length;
  const insertions = new Map<number, string[]>();
  const insertedTitles: string[] = [];
  for (const [key, asset] of unique) {
    if (seen.has(key) || asset.available === false) continue;
    const section = outline.find((item) => asset.sectionId && item.id === asset.sectionId);
    const target = section && headings.find((heading) => heading.line < bibliography && headingKey(heading.title) === headingKey(section.title));
    const end = target ? headings.find((heading) => heading.line > target.line && heading.level <= target.level)?.line ?? lines.length : bibliography;
    const index = Math.min(end, bibliography);
    // Plan metadata is a single-line label, never arbitrary markdown structure.
    const label = (value: string) => value.replace(/[\r\n\[\]]/g, " ").replace(/\s+/g, " ").trim();
    const placeholder = `[Gambar: ${label(asset.title)} - ${label(asset.caption || asset.title)}]`;
    insertions.set(index, [...(insertions.get(index) || []), placeholder]);
    insertedTitles.push(asset.title);
    seen.add(key);
  }
  const result: string[] = [];
  for (let index = 0; index <= lines.length; index += 1) {
    const inserted = insertions.get(index);
    if (inserted) result.push("", ...inserted.flatMap((line) => [line, ""]));
    if (index < lines.length) result.push(lines[index]);
  }
  return { markdown: result.join("\n"), insertedTitles };
}
