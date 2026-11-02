import { isRecord } from "./provider-client";
import { normalizeJournalDoi, normalizeJournalIssns } from "./journal-check";
import { fetchVerificationJson, verifyCrossrefDoi } from "./crossref";

export type JournalVerificationStatus = "verified" | "not_found" | "unavailable" | "manual_required" | "conflict";
type ProviderResult = {
  status: JournalVerificationStatus;
  url?: string;
  venue?: string;
  issn: string[];
};
export type JournalVerificationResult = {
  checkedAt: string;
  status: JournalVerificationStatus;
  confidence: "high" | "medium" | "low";
  input: { doi?: string; venue?: string; issn: string[] };
  crossref: ProviderResult & { doi?: string; title?: string; publisher?: string; type?: string; publisherUrl?: string };
  openAlex: ProviderResult & { inDoaj?: boolean };
  doaj: ProviderResult;
  manual: { sinta: "manual_required"; scopus: "manual_required"; quartile: "manual_required" };
  conflicts: string[];
  sources: { provider: "Crossref" | "OpenAlex" | "DOAJ"; url: string; checkedAt: string; status: JournalVerificationStatus }[];
};

function text(value: unknown, max = 400) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) || undefined : undefined;
}

function sameVenue(a: string, b: string) {
  const clean = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return Boolean(clean(a)) && clean(a) === clean(b);
}

function overlap(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

async function lookupOpenAlex(doi: string | undefined, issn: string[]): Promise<JournalVerificationResult["openAlex"]> {
  const url = doi ? `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`
    : issn[0] ? `https://api.openalex.org/sources/issn:${encodeURIComponent(issn[0])}` : undefined;
  if (!url) return { status: "manual_required", issn: [] };
  const result = await fetchVerificationJson(url);
  if (result.status !== "ok") return { status: result.status, issn: [], url };
  if (!isRecord(result.data)) return { status: "unavailable", issn: [], url };
  const row = result.data;
  if (doi) {
    const returnedDoi = normalizeJournalDoi(row.doi) || (isRecord(row.ids) ? normalizeJournalDoi(row.ids.doi) : undefined);
    if (!returnedDoi) return { status: "unavailable", issn: [], url };
    if (returnedDoi !== doi) return { status: "conflict", issn: [], url };
    if (!isRecord(row.primary_location) || !isRecord(row.primary_location.source)) return { status: "manual_required", issn: [], url };
  }
  const source = doi && isRecord(row.primary_location) && isRecord(row.primary_location.source) ? row.primary_location.source : row;
  const foundIssn = normalizeJournalIssns([...(Array.isArray(source.issn) ? source.issn : []), source.issn_l]);
  if (!doi && !overlap(issn, foundIssn)) return { status: foundIssn.length ? "conflict" : "unavailable", issn: foundIssn, url };
  const venue = text(source.display_name);
  if (!venue && !foundIssn.length) return { status: "unavailable", issn: [], url };
  return { status: "verified", venue, issn: foundIssn, url, ...(typeof source.is_in_doaj === "boolean" ? { inDoaj: source.is_in_doaj } : {}) };
}

async function lookupDoaj(issn: string[]): Promise<ProviderResult> {
  if (!issn.length) return { status: "manual_required", issn: [] };
  const query = issn.map((value) => `issn:${value}`).join(" OR ");
  const url = `https://doaj.org/api/search/journals/${encodeURIComponent(query)}?pageSize=20`;
  const result = await fetchVerificationJson(url);
  if (result.status !== "ok") return { status: result.status, issn: [], url };
  if (!isRecord(result.data) || !Array.isArray(result.data.results)) return { status: "unavailable", issn: [], url };
  // Search ranking is not identity evidence. Only explicit ISSN identifiers count.
  for (const row of result.data.results.slice(0, 20)) {
    if (!isRecord(row) || !isRecord(row.bibjson) || !Array.isArray(row.bibjson.identifier)) continue;
    const foundIssn = normalizeJournalIssns(row.bibjson.identifier.filter((entry) => isRecord(entry) && typeof entry.type === "string" && ["pissn", "eissn", "issn"].includes(entry.type.toLowerCase())).map((entry) => isRecord(entry) ? entry.id : undefined));
    if (overlap(issn, foundIssn)) return { status: "verified", venue: text(row.bibjson.title), issn: foundIssn, url };
  }
  return { status: "not_found", issn: [], url };
}

export async function verifyJournal(input: { doi?: unknown; venue?: unknown; issn?: unknown }): Promise<JournalVerificationResult> {
  const doi = normalizeJournalDoi(input.doi);
  const venue = text(input.venue, 240);
  const issn = normalizeJournalIssns(input.issn).slice(0, 10);
  const [raw, openAlex] = await Promise.all([doi ? verifyCrossrefDoi(doi) : null, lookupOpenAlex(doi, issn)]);
  const crossref: JournalVerificationResult["crossref"] = raw ? {
    status: raw.status, url: raw.url, doi: raw.canonicalDoi || undefined,
    venue: raw.venue || undefined, issn: raw.issn, title: raw.title || undefined,
    publisher: raw.publisher || undefined, type: raw.type || undefined, publisherUrl: raw.publisherUrl || undefined,
  } : { status: "manual_required", issn: [] };
  const trustedIssn = crossref.status === "verified" && crossref.issn.length ? crossref.issn
    : openAlex.status === "verified" && openAlex.issn.length ? openAlex.issn : issn;
  const doaj = await lookupDoaj(trustedIssn.slice(0, 10));
  const conflicts: string[] = [];
  const providers = [crossref, openAlex, doaj];
  if (crossref.status === "conflict" || openAlex.status === "conflict") conflicts.push("Identitas DOI/ISSN respons penyedia tidak cocok dengan permintaan.");
  const records = [{ venue, issn }, ...providers.filter((provider) => provider.status === "verified")];
  for (let a = 0; a < records.length; a++) {
    for (let b = a + 1; b < records.length; b++) {
      if (records[a].issn.length && records[b].issn.length && !overlap(records[a].issn, records[b].issn)) conflicts.push("ISSN berbeda antar input atau sumber.");
      const first = records[a].venue;
      const second = records[b].venue;
      if (first && second && !sameVenue(first, second)) conflicts.push("Nama venue berbeda antar input atau sumber.");
    }
  }
  const found = providers.filter((provider) => provider.status === "verified");
  const status: JournalVerificationStatus = conflicts.length ? "conflict" : found.length ? "verified"
    : providers.some((provider) => provider.status === "unavailable") ? "unavailable"
      : providers.some((provider) => provider.status === "not_found") ? "not_found" : "manual_required";
  const corroborated = found.some((first, i) => found.slice(i + 1).some((second) => overlap(first.issn, second.issn)));
  const checkedAt = new Date().toISOString();
  return {
    checkedAt, status, confidence: status !== "verified" ? "low" : corroborated ? "high" : "medium",
    input: { doi, venue, issn }, crossref, openAlex, doaj,
    manual: { sinta: "manual_required", scopus: "manual_required", quartile: "manual_required" },
    conflicts: [...new Set(conflicts)],
    sources: ([ ["Crossref", crossref], ["OpenAlex", openAlex], ["DOAJ", doaj] ] as const).flatMap(([provider, result]) => result.url ? [{ provider, url: result.url, checkedAt, status: result.status }] : []),
  };
}
