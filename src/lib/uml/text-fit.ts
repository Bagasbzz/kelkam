/**
 * src/lib/uml/text-fit.ts
 * -----------------------------------------------------------------------------
 * Auto-fit label node diagram: pilih font TERBESAR yang masih muat di dalam
 * bentuknya (kotak, oval, belah ketupat), lalu wrap ulang teks untuk ukuran itu.
 *
 * Kenapa: label dulu selalu 13px dan di-wrap per jumlah karakter tetap, jadi
 * teks tampak mini dengan banyak ruang kosong, atau malah keluar garis oval.
 *
 * Prinsip:
 *   - Ukuran & posisi node TIDAK diubah → layout/edge tetap, tidak ada tabrakan.
 *   - Teks dijamin di dalam bentuk: lebar baris diukur per karakter (tabel lebar
 *     glyph Inter), dan lebar tersedia dihitung dari geometri bentuk:
 *       oval        : (x/a)² + (y/b)² ≤ 1   → lebar menyempit di atas/bawah
 *       belah ketupat: |x|/a + |y|/b ≤ 1    → lebar menyempit linear
 *   - Deterministik & tanpa DOM → hasil editor (Node.tsx) = hasil ekspor SVG/DOCX
 *     (render-svg.ts, juga dipakai server).
 * -----------------------------------------------------------------------------
 */

/**
 * Batas font label di dalam bentuk (px). Maks 18 (bukan lebih) supaya ukuran
 * teks antar node tetap seragam secara visual; dulu fixed 13px.
 */
export const FIT_MAX_FONT = 18;
export const FIT_MIN_FONT = 11;
const FONT_STEP = 0.5;
const LINE_HEIGHT_RATIO = 1.2;
const MAX_LINES = 6;
/** Faktor aman pengukuran (hindari teks mepet garis karena beda font fallback). */
const MEASURE_SAFETY = 1.05;

/** Lebar glyph perkiraan (satuan em) untuk Inter/Segoe/Arial weight 500. */
function charEm(ch: string): number {
  if (ch === " ") return 0.28;
  if (/[iljI.,:;'!|`]/.test(ch)) return 0.28;
  if (/[ftr()[\]{}\-/\\"]/.test(ch)) return 0.37;
  if (/[mwMW@%]/.test(ch)) return 0.88;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.6;
  if (/[a-z]/.test(ch)) return 0.56;
  return 0.64;
}

export function measureText(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * fontSize * MEASURE_SAFETY;
}

/**
 * Wrap greedy per kata dengan lebar maksimum (px).
 * `breakWords=false` → return null kalau ada kata yang lebih lebar dari maxWidth
 * (tanda font perlu diperkecil). `true` → kata dipotong per karakter.
 */
function wrapToWidth(text: string, maxWidth: number, fontSize: number, breakWords: boolean): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measureText(word, fontSize) <= maxWidth) {
      line = word;
      continue;
    }
    if (!breakWords) return null;
    // Kata sangat panjang (mis. URL): potong per karakter.
    let chunk = "";
    for (const ch of word) {
      if (measureText(chunk + ch, fontSize) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export type FitShape = "rect" | "ellipse" | "diamond";

export interface FitBox {
  shape: FitShape;
  width: number;
  height: number;
  /** Jarak aman dari garis (px). */
  padX: number;
  padY: number;
}

/** Lebar horizontal yang tersedia untuk blok teks setinggi `blockH` di tengah bentuk. */
function availableWidth(box: FitBox, blockH: number): number {
  const a = box.width / 2 - box.padX;
  const b = box.height / 2 - box.padY;
  const hh = blockH / 2;
  if (a <= 0 || b <= 0 || hh > b) return 0;
  switch (box.shape) {
    case "ellipse":
      return 2 * a * Math.sqrt(1 - (hh / b) ** 2);
    case "diamond":
      return 2 * a * (1 - hh / b);
    default:
      return 2 * a;
  }
}

export interface FittedText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/** Cari font terbesar (FIT_MIN..max) yang membuat teks muat di dalam bentuk. */
export function fitText(text: string, box: FitBox, maxFont = FIT_MAX_FONT): FittedText {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { lines: [], fontSize: maxFont, lineHeight: maxFont * LINE_HEIGHT_RATIO };

  for (let fs = maxFont; fs >= FIT_MIN_FONT; fs -= FONT_STEP) {
    const lh = fs * LINE_HEIGHT_RATIO;
    // Coba jumlah baris 1..N: makin banyak baris, lebar tersedia (oval/ketupat) makin sempit.
    for (let n = 1; n <= MAX_LINES; n++) {
      const avail = availableWidth(box, n * lh);
      if (avail <= 0) break;
      const lines = wrapToWidth(clean, avail, fs, false);
      if (lines && lines.length <= n) return { lines, fontSize: fs, lineHeight: lh };
    }
  }

  // Fallback (teks sangat panjang untuk bentuknya): font minimum, potong kata,
  // dan pangkas baris terakhir dengan elipsis supaya tetap di dalam garis.
  const fs = FIT_MIN_FONT;
  const lh = fs * LINE_HEIGHT_RATIO;
  const innerH = box.height - 2 * box.padY;
  const maxLines = Math.max(1, Math.min(MAX_LINES, Math.floor(innerH / lh)));
  const avail = Math.max(availableWidth(box, maxLines * lh), (box.width - 2 * box.padX) * 0.5, fs * 2);
  const wrapped = wrapToWidth(clean, avail, fs, true) ?? [clean];
  if (wrapped.length <= maxLines) return { lines: wrapped, fontSize: fs, lineHeight: lh };
  const kept = wrapped.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && measureText(last, fs) > avail) last = `${last.slice(0, -2)}…`;
  kept[maxLines - 1] = last;
  return { lines: kept, fontSize: fs, lineHeight: lh };
}

// ---------------------------------------------------------------------------
// Layout label per tipe node (dipakai Node.tsx & render-svg.ts)
// ---------------------------------------------------------------------------

interface NodeLike {
  type: string;
  text: string;
  lines?: string[];
  width: number;
  height: number;
}

export interface NodeTextLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** Koordinat y baris pertama (absolut). */
  firstLineY: number;
  baseline: "middle" | "hanging";
  fontWeight: number;
}

/** Tinggi kotak kepala lifeline (sama dengan Node.tsx / render-svg.ts). */
export const LIFELINE_HEADER_HEIGHT = 46;
/** Font label di LUAR bentuk (actor, fork/join). */
const OUTSIDE_FONT = 14;
const OUTSIDE_LINE_HEIGHT = 18;

function boxFor(node: NodeLike): FitBox | null {
  const { width, height } = node;
  switch (node.type) {
    case "start":
    case "end":
    case "usecase":
      return { shape: "ellipse", width, height, padX: 6, padY: 4 };
    case "decision":
      return { shape: "diamond", width, height, padX: 4, padY: 3 };
    case "activity":
      // Sudut membulat rx=20 → beri ruang horizontal lebih.
      return { shape: "rect", width, height, padX: 12, padY: 5 };
    case "lifeline":
      return { shape: "rect", width, height: LIFELINE_HEADER_HEIGHT, padX: 8, padY: 4 };
    case "actor":
    case "fork":
    case "join":
      return null;
    default:
      return { shape: "rect", width, height, padX: 9, padY: 5 };
  }
}

/**
 * Hitung baris, ukuran font, dan posisi label node.
 * `x`, `y` = pojok kiri atas node (sudah termasuk offset drag).
 * `maxFont` = plafon font seragam diagram (lihat diagramFontCap).
 */
export function layoutNodeText(node: NodeLike, x: number, y: number, maxFont = FIT_MAX_FONT): NodeTextLayout {
  const label = (node.text || node.lines?.join(" ") || "").trim();
  const box = boxFor(node);

  if (!box) {
    // Label di bawah bentuk (actor / fork / join): wrap biasa, tidak dibatasi bentuk.
    const lines = node.lines?.length ? node.lines : label ? [label] : [];
    return {
      lines,
      fontSize: OUTSIDE_FONT,
      lineHeight: OUTSIDE_LINE_HEIGHT,
      firstLineY: y + node.height + 15,
      baseline: node.type === "actor" ? "hanging" : "middle",
      fontWeight: node.type === "actor" ? 600 : 500,
    };
  }

  // Lifeline: kepala kotak relatif kecil → batasi font agar seragam dengan node lain.
  const fitted = fitText(label, box, Math.min(maxFont, node.type === "lifeline" ? 16 : FIT_MAX_FONT));
  const blockOffset = ((fitted.lines.length - 1) * fitted.lineHeight) / 2;
  const centerY = node.type === "lifeline" ? y + LIFELINE_HEADER_HEIGHT / 2 : y + node.height / 2;
  return {
    lines: fitted.lines,
    fontSize: fitted.fontSize,
    lineHeight: fitted.lineHeight,
    firstLineY: centerY - blockOffset,
    baseline: "middle",
    fontWeight: node.type === "lifeline" ? 600 : 500,
  };
}

/** Font terkecil yang boleh dipaksakan ke seluruh diagram demi keseragaman. */
const UNIFORM_FLOOR = 14;

/**
 * Plafon font SERAGAM untuk satu diagram: font hasil fit terkecil di antara
 * node-node berlabel di dalam bentuk, tapi tidak lebih kecil dari UNIFORM_FLOOR.
 * Node yang butuh lebih kecil dari floor tetap mengecil sendiri (tidak menyeret
 * seluruh diagram jadi mini). Hasil: teks besar, padat, dan konsisten.
 */
export function diagramFontCap(nodes: NodeLike[]): number {
  let cap = FIT_MAX_FONT;
  for (const node of nodes) {
    const box = boxFor(node);
    if (!box) continue;
    const label = (node.text || node.lines?.join(" ") || "").trim();
    if (!label) continue;
    const { fontSize } = fitText(label, box, node.type === "lifeline" ? 16 : FIT_MAX_FONT);
    cap = Math.min(cap, Math.max(fontSize, UNIFORM_FLOOR));
  }
  return cap;
}
