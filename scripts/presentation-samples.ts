import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { createStarterDeck, THEME_IDS, THEMES } from "../src/lib/presentation/model";
import { layoutSlide, renderSlideSvg } from "../src/lib/presentation/layout";
import { exportDeckPptx } from "../src/lib/presentation/export-pptx";

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Berikan direktori output absolut sebagai argumen.");
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

async function main() {
  await mkdir(output, { recursive: true });
  const results = [];
  const sections = [];
  for (const theme of THEME_IDS) {
    const deck = createStarterDeck(theme);
    const directory = path.join(output, theme);
    await mkdir(directory, { recursive: true });
    const buffer = await exportDeckPptx(deck);
    await writeFile(path.join(output, `${theme}.pptx`), buffer);
    await writeFile(path.join(directory, "deck.json"), JSON.stringify(deck, null, 2));
    const zip = await JSZip.loadAsync(buffer);
    const slides = [];
    const cards = [];
    for (const [index, slide] of deck.slides.entries()) {
      const scene = layoutSlide(slide, theme, index, deck.slides.length, deck.artDirection, deck.palette);
      const file = `slide-${index + 1}.svg`;
      await writeFile(path.join(directory, file), renderSlideSvg(scene));
      const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
      const text = scene.elements.filter((element) => element.type === "text");
      const mainText = text.filter((element) => element.fontSize >= 15);
      slides.push({ slide: index + 1, title: slide.title, layout: slide.layout, issues: scene.issues, minimumMainFont: Math.min(...mainText.map((element) => element.fontSize)), nativeShapes: (xml.match(/<p:sp>/g) || []).length, nativeTextRuns: (xml.match(/<a:t>/g) || []).length, flattenedImages: (xml.match(/<p:pic>/g) || []).length });
      cards.push(`<figure><a href="${theme}/Slide${index + 1}.PNG"><img src="${theme}/Slide${index + 1}.PNG" alt="${escape(slide.title)}" onerror="this.onerror=null;this.src='${theme}/${file}'"></a><figcaption><b>${index + 1}. ${escape(slide.title)}</b><span>${slide.layout} / ${escape(slide.notes)}</span><a href="${theme}/${file}">Bandingkan preview SVG</a></figcaption></figure>`);
    }
    results.push({ theme, title: deck.title, bytes: buffer.length, slides });
    sections.push(`<section id="${theme}"><header><div><small>${THEMES[theme].label.toUpperCase()} / ${escape(deck.artDirection?.style || "classic")}</small><h2>${escape(deck.title)}</h2></div><nav><a href="${theme}.pptx">Buka PPTX editable + motion</a><a href="${theme}.pdf">Buka PDF PowerPoint</a></nav></header><div class="slides">${cards.join("")}</div></section>`);
    console.log(`${theme}: ${deck.slides.length} slides, ${buffer.length} bytes -> ${path.join(output, `${theme}.pptx`)}`);
  }
  await writeFile(path.join(output, "checks.json"), JSON.stringify(results, null, 2));
  await writeFile(path.join(output, "index.html"), `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review PPTX KeluhKampus</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f4ee;color:#23382e;font:15px/1.6 Arial,sans-serif}main{max-width:1320px;margin:auto;padding:36px 24px}h1,h2{font-family:Georgia,serif;line-height:1.2}h1{font-size:42px}h2{font-size:27px;margin:8px 0}small{letter-spacing:.15em}section{margin:48px 0 64px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:24px}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#245d3e}nav a{padding:9px 14px;background:#fff;border:1px solid #cdd7ca;text-decoration:none}.slides{display:grid;grid-template-columns:1fr 1fr;gap:28px}figure{margin:0;background:white;box-shadow:0 8px 25px #263d2012}img{display:block;width:100%;aspect-ratio:16/9}figcaption{padding:16px;display:flex;flex-direction:column;gap:8px}figcaption span,figcaption a{font-size:12px;color:#526456}.intro{max-width:850px}aside{padding:16px;background:#e5eddf;border-left:3px solid #5e7d4b}@media(max-width:760px){.slides{grid-template-columns:1fr}header{display:block}nav{margin-top:16px}h1{font-size:32px}}</style><main><small>KELUHKAMPUS / REVIEW LOKAL</small><h1>Tiga arah visual, lima komposisi.</h1><p class="intro">Contoh dibuat oleh exporter aplikasi dari materi demonstrasi terstruktur, bukan generasi AI live. Masing-masing deck berisi lima slide. PNG dan PDF, bila tersedia, dirender langsung oleh Microsoft PowerPoint. Jika PNG belum tersedia, galeri menampilkan SVG perkiraan dan bukan bukti render PowerPoint.</p><aside>Review utama: keterbacaan, ruang kosong, ritme komposisi, relevansi elemen visual, serta editabilitas di PowerPoint. Ini fondasi beta dengan teks dan bentuk, belum desain kaya gambar seperti Canva. Catatan pembicara dan sumber tersimpan dalam PPTX.</aside>${sections.join("")}</main></html>`);
  console.log(`Review gallery: ${path.join(output, "index.html")}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
