/**
 * scripts/build-presentation-fonts.ts
 * -----------------------------------------------------------------------------
 * Font presentasi (Google Fonts, lisensi SIL OFL) disimpan sebagai TTF statis di
 * public/fonts/presentasi/<slug>-<berat>.ttf. Skrip ini membaca file lokal tersebut lalu menulis:
 *   - src/lib/presentation/font-metrics.ts  (lebar huruf untuk memecah baris secara tepat)
 *   - src/components/presentation/fonts.css (@font-face untuk pratinjau di browser)
 *
 * Menambah font: tambahkan ke CATALOG_FONTS (src/lib/presentation/fonts.ts), unduh TTF-nya, mis.
 *   curl -s "https://fonts.googleapis.com/css2?family=Fraunces:wght@700"   (ambil URL .ttf di dalamnya)
 *   curl -s -o public/fonts/presentasi/fraunces-700.ttf <URL>
 * lalu jalankan: npx tsx scripts/build-presentation-fonts.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CATALOG_FONTS } from "../src/lib/presentation/fonts";
import { parseTtf } from "../src/lib/presentation/ttf";

const root = path.resolve(__dirname, "..");
const fontDir = path.join(root, "public", "fonts", "presentasi");
// Karakter yang diukur satu per satu; karakter lain memakai lebar rata-rata huruf kecil.
const RANGES: [number, number][] = [[32, 126], [160, 255]];

async function main() {
  const metrics: Record<string, { file: string; widths: string; fallback: number; lead: number }> = {};
  const faces: string[] = [];
  for (const font of CATALOG_FONTS) {
    for (const weight of font.weights) {
      const file = `${font.slug}-${weight}.ttf`;
      const data = await readFile(path.join(fontDir, file));
      const info = parseTtf(data);
      if (info.family !== font.family) throw new Error(`Nama keluarga ${file} adalah "${info.family}", bukan "${font.family}".`);
      if (info.fsType & 0x2) throw new Error(`${font.family} tidak mengizinkan penanaman (fsType ${info.fsType}).`);
      const widths: number[] = [];
      for (const [from, to] of RANGES) for (let cp = from; cp <= to; cp++) widths.push(Math.round((info.advance(cp) ?? 0) * 1000 / info.unitsPerEm));
      const lower = [..."abcdefghijklmnopqrstuvwxyz"].map((char) => info.advance(char.codePointAt(0)!) ?? 0);
      const fallback = Math.round(lower.reduce((sum, value) => sum + value, 0) / lower.length * 1000 / info.unitsPerEm);
      const bold = weight >= 600;
      const lead = Math.round((info.winAscent + info.winDescent) / info.unitsPerEm * 1000) / 1000;
      metrics[`${font.family}${bold ? "|b" : ""}`] = { file, widths: widths.join(","), fallback, lead };
      faces.push(`@font-face{font-family:"${font.family}";src:url("/fonts/presentasi/${file}") format("truetype");font-weight:${bold ? 700 : 400};font-style:normal;font-display:swap}`);
      console.log(`${file}: ${info.family} / ${info.subfamily}, ${data.length} byte, fsType ${info.fsType}, lead ${lead}`);
    }
  }
  await writeFile(path.join(root, "src", "lib", "presentation", "font-metrics.ts"),
    `// Dibuat oleh scripts/build-presentation-fonts.ts. Jangan diedit manual.\n` +
    `// Lebar huruf per mil em untuk karakter ${RANGES.map(([a, b]) => `${a}-${b}`).join(" dan ")}.\n` +
    `export const FONT_METRIC_RANGES: readonly (readonly [number, number])[] = ${JSON.stringify(RANGES)};\n` +
    `export const FONT_METRICS: Record<string, { file: string; widths: string; fallback: number; lead: number }> = {\n` +
    Object.entries(metrics).map(([key, value]) => `  ${JSON.stringify(key)}: { file: ${JSON.stringify(value.file)}, fallback: ${value.fallback}, lead: ${value.lead}, widths: ${JSON.stringify(value.widths)} },`).join("\n") +
    `\n};\n`);
  await writeFile(path.join(root, "src", "components", "presentation", "fonts.css"),
    `/* Dibuat oleh scripts/build-presentation-fonts.ts. Font presentasi (SIL OFL) untuk pratinjau slide. */\n${faces.join("\n")}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
