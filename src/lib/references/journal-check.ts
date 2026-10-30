/** Client-safe journal lookup helpers. Lookup links are not accreditation evidence. */
export type JournalVerification = {
  sintaRank?: 1 | 2 | 3 | 4 | 5 | 6;
  scimagoQuartile?: "Q1" | "Q2" | "Q3" | "Q4";
  evidenceUrl?: string;
  checkedAt: string;
  method: "user";
};

const SINTA_HOST = "sinta.kemdiktisaintek.go.id";
const EVIDENCE_HOSTS = new Set([
  SINTA_HOST,
  "sinta.kemdikbud.go.id",
  "scimagojr.com",
  "www.scimagojr.com",
]);

export function normalizeJournalIssns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const compact = item.trim().toUpperCase().replace(/-/g, "");
    return /^\d{7}[\dX]$/.test(compact) ? [`${compact.slice(0, 4)}-${compact.slice(4)}`] : [];
  })));
}

export function safeReferenceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href : null;
  } catch {
    return null;
  }
}

/** Invalid/untrusted records return null; callers distinguish that from an explicit clear. */
export function parseJournalVerification(value: unknown): JournalVerification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["sintaRank", "scimagoQuartile", "evidenceUrl", "checkedAt", "method"].includes(key))) return null;
  if (record.method !== "user" || typeof record.checkedAt !== "string") return null;
  const date = new Date(record.checkedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== record.checkedAt) return null;
  if (record.sintaRank !== undefined && (typeof record.sintaRank !== "number" || !Number.isInteger(record.sintaRank) || record.sintaRank < 1 || record.sintaRank > 6)) return null;
  if (record.scimagoQuartile !== undefined && (typeof record.scimagoQuartile !== "string" || !["Q1", "Q2", "Q3", "Q4"].includes(record.scimagoQuartile))) return null;
  if (record.sintaRank === undefined && record.scimagoQuartile === undefined) return null;

  let evidenceUrl: string | undefined;
  if (record.evidenceUrl !== undefined) {
    if (typeof record.evidenceUrl !== "string" || record.evidenceUrl.length > 2048) return null;
    const safe = safeReferenceUrl(record.evidenceUrl);
    if (!safe) return null;
    const url = new URL(safe);
    if (url.protocol !== "https:" || url.port || !EVIDENCE_HOSTS.has(url.hostname)) return null;
    evidenceUrl = url.href;
  }
  return {
    ...(record.sintaRank !== undefined ? { sintaRank: record.sintaRank as JournalVerification["sintaRank"] } : {}),
    ...(record.scimagoQuartile !== undefined ? { scimagoQuartile: record.scimagoQuartile as JournalVerification["scimagoQuartile"] } : {}),
    ...(evidenceUrl ? { evidenceUrl } : {}),
    checkedAt: record.checkedAt,
    method: "user",
  };
}

/** Search each identifier independently: requiring title AND both ISSNs often finds nothing. */
export function buildJournalCheckLinks(source: { venue?: string | null; issn?: string[] }): { label: string; url: string }[] {
  const terms = normalizeJournalIssns(source.issn).map((issn) => ({ label: `ISSN ${issn}`, query: issn.replace(/-/g, ""), fallback: `("${issn}" OR "${issn.replace(/-/g, "")}")` }));
  const venue = source.venue?.trim();
  if (venue) terms.push({ label: `judul ${venue}`, query: venue, fallback: `"${venue.replace(/"/g, " ")}"` });
  return terms.flatMap((term) => [
    { label: `SINTA: ${term.label}`, url: `https://${SINTA_HOST}/journals?q=${encodeURIComponent(term.query)}` },
    { label: `Scimago: ${term.label}`, url: `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(term.query)}` },
    { label: `Google SINTA: ${term.label}`, url: `https://www.google.com/search?q=${encodeURIComponent(`site:${SINTA_HOST}/journals ${term.fallback}`)}` },
    { label: `Google Scimago: ${term.label}`, url: `https://www.google.com/search?q=${encodeURIComponent(`site:scimagojr.com/journalsearch.php ${term.fallback}`)}` },
  ]);
}
