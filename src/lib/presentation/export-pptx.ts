import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { deckSchema, FONT_PAIRS, THEMES } from "./model";
import { SLIDE_HEIGHT, SLIDE_WIDTH, type ImageElement, type ShapeElement, type SlideElement, type TextElement } from "./layout";
import { sceneFor } from "./design";
import { isCatalogFont } from "./fonts";
import { FONT_METRICS } from "./font-metrics";
import { parseTtf, toEot } from "./ttf";
import { builtinAssetOf } from "./assets";
import { createHash } from "node:crypto";

export interface PresentationAsset { data: Buffer; mime: "image/png" | "image/jpeg" }
export interface PresentationExportOptions { assets?: Record<string, PresentationAsset> }

// Read only bounded raster headers. No URLs, filesystem access, SVG, or decoding.
function imageDimensions(asset: PresentationAsset): { width: number; height: number } {
  if (!asset || (asset.mime !== "image/png" && asset.mime !== "image/jpeg")) throw new Error("Aset presentasi harus berupa PNG/JPEG.");
  const data = asset.data;
  if (!Buffer.isBuffer(data) || data.length < 24 || data.length > 8 * 1024 * 1024) throw new Error("Aset presentasi harus berupa gambar PNG/JPEG maksimal 8 MB.");
  let width = 0, height = 0;
  if (asset.mime === "image/png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && data.toString("ascii", 12, 16) === "IHDR") {
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
  } else if (asset.mime === "image/jpeg" && data[0] === 0xff && data[1] === 0xd8) {
    for (let offset = 2; offset + 8 < data.length;) {
      if (data[offset++] !== 0xff) break;
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) { height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); break; }
      offset += length;
    }
  }
  if (!width || !height || width > 8192 || height > 8192 || width * height > 24_000_000) throw new Error("Aset presentasi PNG/JPEG tidak valid atau dimensinya terlalu besar.");
  return { width, height };
}

/** Server-only entry point. Type, illustration and framing stay native/editable. */
export async function exportDeckPptx(input: unknown, options: PresentationExportOptions = {}): Promise<Buffer> {
  const deck = deckSchema.parse(input);
  const palette = THEMES[deck.theme];
  const fonts = deck.design ? FONT_PAIRS[deck.design.fonts] : { heading: palette.headingFont, body: palette.bodyFont };
  const scenes = deck.slides.map((_, index) => sceneFor(deck, index));
  const assets = new Map<string, { asset: PresentationAsset; width: number; height: number }>();
  let assetBytes = 0;
  // Every image the scenes draw (slide art and the deck logo) must be supplied by the caller;
  // built-in design textures ("aset:...") are read from the app's own public folder.
  for (const element of scenes.flatMap((scene) => scene.elements)) {
    if (element.type !== "image" || assets.has(element.fileId)) continue;
    const id = element.fileId;
    const builtin = builtinAssetOf(id);
    if (!builtin && (!options.assets || !Object.hasOwn(options.assets, id))) throw new Error(`Aset gambar slide tidak tersedia: ${id}. Muat aset sebelum mengekspor.`);
    const asset: PresentationAsset = builtin ? { data: await readFile(path.join(PRESENTATION_ASSET_DIR, `${builtin}.png`)), mime: "image/png" } : options.assets![id];
    const dimensions = imageDimensions(asset);
    assetBytes += asset.data.length;
    if (assetBytes > 32 * 1024 * 1024) throw new Error("Total aset presentasi melebihi 32 MB.");
    assets.set(id, { asset, ...dimensions });
  }
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "PRESENTATION_STUDIO", width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pptx.layout = "PRESENTATION_STUDIO";
  pptx.author = "KeluhKampus Presentation Studio";
  pptx.subject = "Presentasi dengan elemen native yang dapat diedit";
  pptx.title = deck.title;
  pptx.company = "KeluhKampus";
  pptx.theme = { headFontFace: fonts.heading, bodyFontFace: fonts.body };

  deck.slides.forEach((slide, index) => {
    const page = pptx.addSlide();
    const scene = scenes[index];
    page.background = { color: scene.background };
    scene.elements.forEach((element, elementIndex) => {
      const { x, y, w, h } = element;
      const objectName = `studio-${elementIndex}`;
      if (element.type === "text") {
        const shadow = element.shadow ? { type: "outer" as const, blur: 0, opacity: 1, color: element.shadow.color, offset: Math.hypot(element.shadow.dx, element.shadow.dy) * 72, angle: Math.round((Math.atan2(element.shadow.dy, element.shadow.dx) * 180 / Math.PI + 360) % 360) } : undefined;
        page.addText(textRuns(element), {
          x, y, w, h, objectName, fontFace: element.fontFace, fontSize: element.fontSize,
          color: element.color, bold: element.bold, align: element.align,
          valign: "top", margin: 0, breakLine: false, paraSpaceAfter: 0,
          // Font katalog: spasi baris tepat (poin) agar sama dengan pratinjau, terlepas dari metrik tinggi fontnya.
          ...(isCatalogFont(element.fontFace) ? { lineSpacing: Math.round(element.lineHeight * element.fontSize * 10) / 10 } : { lineSpacingMultiple: element.lineHeight }),
          ...(element.outline ? { outline: { color: element.outline.color, size: element.outline.width } } : {}),
          ...(shadow ? { shadow } : {}),
          ...(element.spacing ? { charSpacing: element.spacing } : {}),
          lang: "id-ID", fit: "none",
        });
      } else if (element.type === "shape") {
        page.addShape(pptx.ShapeType[element.shape === "polygon" ? "rect" : element.shape], {
          x, y, w, h, objectName, fill: { color: element.fill, transparency: Math.round((1 - (element.opacity ?? 1)) * 100) },
          line: { color: element.lineColor ?? element.fill, width: element.lineWidth ?? 0, transparency: element.lineColor ? 0 : 100, ...(element.dash ? { dashType: element.dash === "dot" ? "sysDot" as const : "dash" as const } : {}) },
          ...(element.shape === "roundRect" ? { rectRadius: 0.12 } : {}),
        });
      } else if (element.type === "image") {
        const { asset, width, height } = assets.get(element.fileId)!;
        const scale = Math.min(w / width, h / height);
        const geometry = element.crop === "contain" ? { x: x + (w - width * scale) / 2, y: y + (h - height * scale) / 2, w: width * scale, h: height * scale } : { x, y, w, h };
        page.addImage({ ...geometry, objectName, data: `data:${asset.mime};base64,${asset.data.toString("base64")}`, altText: element.alt, transparency: Math.round((1 - (element.opacity ?? 1)) * 100), ...(element.rotate ? { rotate: element.rotate } : {}) });
      } else {
        page.addShape(pptx.ShapeType.line, { x, y, w, h, objectName, flipV: element.flipV, line: { color: element.color, width: element.lineWidth, transparency: Math.round((1 - (element.opacity ?? 1)) * 100), beginArrowType: "none", endArrowType: "none", ...(element.dash ? { dashType: element.dash === "dot" ? "sysDot" as const : "dash" as const } : {}) } });
      }
    });
    page.addNotes([slide.notes || "Tidak ada catatan pembicara.", `Sumber: ${slide.source || "Belum dicantumkan."}`].join("\n\n"));
  });

  const output = await pptx.write({ outputType: "nodebuffer", compression: true });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as Uint8Array);
  if (buffer.length > 48 * 1024 * 1024) throw new Error("Ukuran presentasi melampaui batas ekspor.");
  // Only postprocess our own bounded generated ZIP, never a user-supplied archive.
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).length > 512) throw new Error("Struktur presentasi melampaui batas ekspor.");
  for (let index = 0; index < deck.slides.length; index++) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    let xml = await zip.file(path)!.async("string");
    if (xml.length > 2_000_000) throw new Error("XML slide melampaui batas ekspor.");
    xml = xml.replace(/<p:sp>[\s\S]*?<\/p:sp>/g, (node) => {
      const elementIndex = /name="studio-(\d+)"/.exec(node)?.[1];
      const element = elementIndex === undefined ? undefined : scenes[index].elements[Number(elementIndex)];
      if (element?.type !== "shape") return node;
      let shape = node;
      if (element.shape === "polygon") shape = shape.replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/, polygonGeometry(element));
      // Isi bentuk ada di <p:spPr> sebelum <a:ln>: garis terbuka tanpa isi, atau gradien linear.
      if (element.open) shape = shape.replace(/(<p:spPr>[\s\S]*?)<a:solidFill>[\s\S]*?<\/a:solidFill>(?=[\s\S]*?<a:ln)/, "$1<a:noFill/>");
      else if (element.gradient) shape = shape.replace(/(<p:spPr>[\s\S]*?)<a:solidFill>[\s\S]*?<\/a:solidFill>(?=[\s\S]*?<a:ln)/, `$1${gradientXml(element)}`);
      return shape;
    });
    xml = xml.replace(/<p:pic>[\s\S]*?<\/p:pic>/g, (node) => {
      const elementIndex = /name="studio-(\d+)"/.exec(node)?.[1];
      const element = elementIndex === undefined ? undefined : scenes[index].elements[Number(elementIndex)];
      if (element?.type !== "image") return node;
      let picture = node;
      if (element.crop === "cover") {
        const dimensions = assets.get(element.fileId)!;
        picture = picture.replace(/<a:stretch>/, `${imageCropXml(element, dimensions.width, dimensions.height)}<a:stretch>`);
      }
      // Framed photos are clipped by the picture geometry itself, so they stay real, replaceable pictures.
      if (element.mask === "ellipse") picture = picture.replace(/<a:prstGeom prst="rect">/, '<a:prstGeom prst="ellipse">');
      else if (element.mask) picture = picture.replace(/<a:prstGeom\b[\s\S]*?<\/a:prstGeom>/, pathGeometry(element.mask));
      // Tekstur abu-abu diwarnai PowerPoint sendiri (duotone), sama dengan filter pratinjau.
      if (element.tint) picture = picture.replace(/<a:blip ([^>]*?)\/>/, `<a:blip $1><a:duotone><a:srgbClr val="${element.tint.dark}"/><a:srgbClr val="${element.tint.light}"/></a:duotone></a:blip>`)
        .replace(/<a:blip ([^>]*?)>(?!<a:duotone>)/, `<a:blip $1><a:duotone><a:srgbClr val="${element.tint.dark}"/><a:srgbClr val="${element.tint.light}"/></a:duotone>`);
      return picture;
    });
    const motion = deck.slides[index].visual?.motion ?? "none";
    if (motion !== "none") {
      const transition = `<p:transition spd="med" advClick="1">${motion === "push" ? '<p:push dir="l"/>' : "<p:fade/>"}</p:transition>`;
      // Reveal is a real automatic heading entrance, not Morph or whole-slide raster animation.
      const heading = scenes[index].elements.findIndex((element) => element.type === "text" && element.editKey === "title");
      const target = new RegExp(`<p:cNvPr id="(\\d+)" name="studio-${heading}"`).exec(xml)?.[1];
      const timing = motion === "reveal" && target ? entranceXml(target) : "";
      xml = xml.replace("</p:sld>", `${transition}${timing}</p:sld>`);
    }
    zip.file(path, xml);
  }
  await embedFonts(zip, scenes.flatMap((scene) => scene.elements));
  await dedupeMedia(zip);
  const result = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (result.length > 48 * 1024 * 1024) throw new Error("Ukuran presentasi melampaui batas ekspor.");
  return result;
}

/**
 * Tanam font katalog yang dipakai slide ke dalam PPTX (format .fntdata = EOT tanpa kompresi), supaya
 * PowerPoint menampilkan huruf yang sama dengan pratinjau tanpa pengguna memasang font. File font yang
 * tidak ditemukan dilewati: PowerPoint lalu memakai font pengganti, ekspor tidak gagal.
 */
export const PRESENTATION_FONT_DIR = path.join(process.cwd(), "public", "fonts", "presentasi");
export const PRESENTATION_ASSET_DIR = path.join(process.cwd(), "public", "aset-presentasi");

async function embedFonts(zip: JSZip, elements: readonly SlideElement[]) {
  const wanted = new Map<string, { regular: boolean; bold: boolean }>();
  for (const element of elements) {
    if (element.type !== "text" || !isCatalogFont(element.fontFace)) continue;
    const entry = wanted.get(element.fontFace) ?? { regular: false, bold: false };
    entry[element.bold ? "bold" : "regular"] = true;
    wanted.set(element.fontFace, entry);
  }
  if (!wanted.size) return;
  const list: string[] = [];
  const rels: string[] = [];
  let n = 0;
  for (const [family, use] of wanted) {
    const parts: string[] = [];
    let panose = "";
    for (const style of ["regular", "bold"] as const) {
      if (!use[style]) continue;
      // Gaya tebal memakai file 700 bila ada; bila keluarga hanya punya satu file, file itu dipakai.
      const entry = FONT_METRICS[style === "bold" ? `${family}|b` : family] ?? FONT_METRICS[style === "bold" ? family : `${family}|b`];
      if (!entry) continue;
      let data: Buffer;
      try { data = await readFile(path.join(PRESENTATION_FONT_DIR, entry.file)); } catch { continue; }
      const info = parseTtf(data);
      panose ||= Buffer.from(info.panose).toString("hex").toUpperCase();
      n++;
      zip.file(`ppt/fonts/font${n}.fntdata`, toEot(data, info));
      rels.push(`<Relationship Id="rIdFont${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/font${n}.fntdata"/>`);
      parts.push(`<p:${style} r:id="rIdFont${n}"/>`);
    }
    if (parts.length) list.push(`<p:embeddedFont><p:font typeface="${family}" panose="${panose}" pitchFamily="2" charset="0"/>${parts.join("")}</p:embeddedFont>`);
  }
  if (!list.length) return;
  const types = await zip.file("[Content_Types].xml")!.async("string");
  if (!types.includes('Extension="fntdata"')) zip.file("[Content_Types].xml", types.replace(/(<Types[^>]*>)/, `$1<Default Extension="fntdata" ContentType="application/x-fontdata"/>`));
  const relsPath = "ppt/_rels/presentation.xml.rels";
  zip.file(relsPath, (await zip.file(relsPath)!.async("string")).replace("</Relationships>", `${rels.join("")}</Relationships>`));
  let presentation = await zip.file("ppt/presentation.xml")!.async("string");
  presentation = presentation.replace(/<p:presentation\b/, '<p:presentation embedTrueTypeFonts="1"');
  presentation = presentation.replace(/(<p:notesSz\b[^>]*\/>)/, `$1<p:embeddedFontLst>${list.join("")}</p:embeddedFontLst>`);
  zip.file("ppt/presentation.xml", presentation);
}

function polygonGeometry(element: ShapeElement): string {
  return pathGeometry(element.points!, !element.open);
}

function pathGeometry(points: readonly (readonly [number, number])[], closed = true): string {
  const point = ([x, y]: readonly [number, number]) => `<a:pt x="${Math.round(x * 100000)}" y="${Math.round(y * 100000)}"/>`;
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="100000" h="100000"${closed ? "" : ' fill="none"'}><a:moveTo>${point(points[0])}</a:moveTo>${points.slice(1).map((p) => `<a:lnTo>${point(p)}</a:lnTo>`).join("")}${closed ? "<a:close/>" : ""}</a:path></a:pathLst></a:custGeom>`;
}

function gradientXml(element: ShapeElement): string {
  const from = Math.round((element.opacity ?? 1) * 100000), to = Math.round((element.gradient!.toOpacity ?? 1) * 100000);
  return `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="${element.fill}"><a:alpha val="${from}"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="${element.gradient!.to}"><a:alpha val="${to}"/></a:srgbClr></a:gs></a:gsLst><a:lin ang="${Math.round(((element.gradient!.angle % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill>`;
}

/** Teks dengan judul dua warna dikirim sebagai run per kata; baris dipisah breakLine. */
function textRuns(element: TextElement): string | { text: string; options: { color?: string; breakLine?: boolean } }[] {
  if (!element.accent) return element.lines.join("\n");
  const runs: { text: string; options: { color?: string; breakLine?: boolean } }[] = [];
  let word = 0;
  element.lines.forEach((line, i) => {
    const words = line.split(" ");
    words.forEach((value, k) => {
      const color = word++ >= element.accent!.from ? element.accent!.color : element.color;
      runs.push({ text: k < words.length - 1 ? `${value} ` : value, options: { color, ...(k === words.length - 1 && i < element.lines.length - 1 ? { breakLine: true } : {}) } });
    });
  });
  return runs;
}

/**
 * Tekstur yang sama dipakai di banyak slide; pptxgenjs menyimpan salinan per gambar. Satukan file media
 * yang isinya identik agar ukuran PPTX tidak membengkak.
 */
async function dedupeMedia(zip: JSZip) {
  const seen = new Map<string, string>();
  const replace = new Map<string, string>();
  for (const name of Object.keys(zip.files).filter((file) => file.startsWith("ppt/media/") && !zip.files[file].dir).sort()) {
    const data = await zip.file(name)!.async("nodebuffer");
    const key = createHash("sha1").update(data).digest("hex");
    const first = seen.get(key);
    if (first) { replace.set(name.slice(4), first.slice(4)); zip.remove(name); } else seen.set(key, name);
  }
  if (!replace.size) return;
  for (const rels of Object.keys(zip.files).filter((file) => /^ppt\/(slides|slideLayouts|slideMasters)\/_rels\/.*\.rels$/.test(file))) {
    let xml = await zip.file(rels)!.async("string");
    let changed = false;
    xml = xml.replace(/Target="\.\.\/(media\/[^"]+)"/g, (match, target: string) => {
      const next = replace.get(target);
      if (!next) return match;
      changed = true;
      return `Target="../${next}"`;
    });
    if (changed) zip.file(rels, xml);
  }
}

function imageCropXml(element: ImageElement, width: number, height: number): string {
  const imageRatio = width / height, boxRatio = element.w / element.h;
  const horizontal = imageRatio > boxRatio ? Math.round((1 - boxRatio / imageRatio) * 50000) : 0;
  const vertical = imageRatio < boxRatio ? Math.round((1 - imageRatio / boxRatio) * 50000) : 0;
  return `<a:srcRect l="${horizontal}" r="${horizontal}" t="${vertical}" b="${vertical}"/>`;
}

function entranceXml(target: string): string {
  // The click group, effect group and build list mirror a PowerPoint-authored fade.
  // A timing tree without these wrappers survives XML checks but Office ignores it.
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="withEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="7" dur="550"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="${target}" grpId="0" animBg="1"/></p:bldLst></p:timing>`;
}
