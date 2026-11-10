import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

export const alt = `${SITE_NAME}: ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "#0f172a", color: "#fff" }}>
        <div style={{ fontSize: 34, fontWeight: 700, color: "#93c5fd" }}>{SITE_NAME}</div>
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, marginTop: 24 }}>Laporan dan PPT kuliah, dibantu AI</div>
        <div style={{ fontSize: 30, marginTop: 32, color: "#cbd5e1" }}>Sumber jurnal asli, desain slide unik, unduh DOCX dan PPTX</div>
      </div>
    ),
    size,
  );
}
