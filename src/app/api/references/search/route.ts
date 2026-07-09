import { NextResponse } from "next/server";

export const maxDuration = 30;

function toApa(paper: any) {
  const authors = (paper.authors || []).slice(0, 5).map((author: any) => author.name).join(", ");
  const year = paper.year || "n.d.";
  const title = paper.title || "Tanpa judul";
  const venue = paper.venue || paper.publicationVenue?.name || "";
  return `${authors || "Penulis tidak tersedia"} (${year}). ${title}.${venue ? ` ${venue}.` : ""}`;
}

export async function POST(req: Request) {
  try {
    const { query, limit = 5 } = await req.json();

    if (!query?.trim()) {
      return NextResponse.json({ success: false, error: "Query referensi tidak boleh kosong." }, { status: 400 });
    }

    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query);
    url.searchParams.set("limit", String(Math.min(Number(limit) || 5, 8)));
    url.searchParams.set("fields", "title,authors,year,venue,url,abstract,externalIds,openAccessPdf,isOpenAccess,citationCount,publicationTypes,publicationVenue");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 60 * 60 * 24 },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Gagal mencari referensi ilmiah.");
    }

    const json = await response.json();
    const papers = (json.data || []).map((paper: any) => ({
      id: paper.paperId,
      title: paper.title,
      authors: (paper.authors || []).map((author: any) => author.name),
      year: paper.year,
      venue: paper.venue || paper.publicationVenue?.name || "",
      abstract: paper.abstract || "Abstrak tidak tersedia dari Semantic Scholar.",
      url: paper.url,
      pdfUrl: paper.openAccessPdf?.url || null,
      doi: paper.externalIds?.DOI || null,
      citationCount: paper.citationCount || 0,
      isOpenAccess: Boolean(paper.isOpenAccess || paper.openAccessPdf?.url),
      citationApa: toApa(paper),
    }));

    return NextResponse.json({ success: true, data: papers });
  } catch (error: any) {
    console.error("API /api/references/search Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal mencari referensi." },
      { status: 500 }
    );
  }
}
