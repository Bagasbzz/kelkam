/**
 * src/lib/presentation/fonts.ts
 * -----------------------------------------------------------------------------
 * Katalog font presentasi. Font sistem lama tetap didukung untuk deck lama; font katalog
 * (Google Fonts, SIL OFL) dipakai di pratinjau lewat @font-face dan ditanam ke PPTX
 * saat ekspor, sehingga tampil sama di PowerPoint tanpa memasang font.
 * File TTF dan metrik dibuat oleh scripts/build-presentation-fonts.ts.
 */

export const SYSTEM_FONTS = ["Arial", "Arial Black", "Impact", "Georgia", "Century Gothic", "Trebuchet MS", "Tahoma"] as const;

export const CATALOG_FONTS = [
  { family: "DM Serif Display", slug: "dm-serif-display", weights: [400] },
  { family: "DM Sans", slug: "dm-sans", weights: [400, 700] },
  { family: "Playfair Display", slug: "playfair-display", weights: [700] },
  { family: "Source Sans 3", slug: "source-sans-3", weights: [400, 700] },
  { family: "Cinzel", slug: "cinzel", weights: [700] },
  { family: "Mulish", slug: "mulish", weights: [400, 700] },
  { family: "Plus Jakarta Sans", slug: "plus-jakarta-sans", weights: [400, 700] },
  { family: "Fredoka", slug: "fredoka", weights: [700] },
  { family: "Nunito", slug: "nunito", weights: [400, 700] },
  { family: "Archivo Black", slug: "archivo-black", weights: [400] },
  { family: "Archivo", slug: "archivo", weights: [400, 700] },
  { family: "Bebas Neue", slug: "bebas-neue", weights: [400] },
  { family: "Barlow", slug: "barlow", weights: [400, 700] },
  { family: "Fraunces", slug: "fraunces", weights: [700] },
  { family: "Outfit", slug: "outfit", weights: [400, 700] },
  { family: "Lilita One", slug: "lilita-one", weights: [400] },
  { family: "Caveat", slug: "caveat", weights: [700] },
  { family: "Unbounded", slug: "unbounded", weights: [700] },
  { family: "Space Grotesk", slug: "space-grotesk", weights: [400, 700] },
  { family: "Syne", slug: "syne", weights: [700] },
  { family: "Manrope", slug: "manrope", weights: [400, 700] },
  { family: "Shrikhand", slug: "shrikhand", weights: [400] },
  { family: "Gloock", slug: "gloock", weights: [400] },
] as const;

export type SystemFont = (typeof SYSTEM_FONTS)[number];
export type CatalogFont = (typeof CATALOG_FONTS)[number]["family"];
export type PresentationFont = SystemFont | CatalogFont;

export interface FontPair {
  heading: PresentationFont;
  body: PresentationFont;
  /** Judul ditulis tebal; false untuk font display satu ketebalan (sudah tebal dari bentuknya). */
  headingBold: boolean;
  label: string;
  /** Kesan dan kegunaan, dipakai di pilihan Tampilan dan sebagai panduan AI. */
  mood: string;
}

const pair = (heading: PresentationFont, body: PresentationFont, headingBold: boolean, label: string, mood: string): FontPair => ({ heading, body, headingBold, label, mood });

export const FONT_PAIRS = {
  // Font sistem (deck lama).
  tegas: pair("Arial Black", "Arial", true, "Tegas (sistem)", "huruf sistem tebal"),
  kondensasi: pair("Impact", "Arial", false, "Kondensasi (sistem)", "huruf sistem ramping tinggi"),
  elegan: pair("Georgia", "Arial", false, "Elegan (sistem)", "serif sistem"),
  geometris: pair("Century Gothic", "Century Gothic", true, "Geometris (sistem)", "sans sistem bulat"),
  ramah: pair("Trebuchet MS", "Trebuchet MS", true, "Ramah (sistem)", "sans sistem"),
  bersih: pair("Tahoma", "Tahoma", true, "Bersih (sistem)", "sans sistem sederhana"),
  // Font katalog, tertanam di PPTX.
  majalah: pair("DM Serif Display", "DM Sans", false, "Majalah", "serif display anggun + sans bersih; editorial, sastra, sosial, seminar"),
  klasik: pair("Playfair Display", "Source Sans 3", true, "Klasik akademik", "serif klasik kontras tinggi; sidang, hukum, sejarah, formal"),
  formal: pair("Cinzel", "Mulish", true, "Formal kapital", "kapital berkelas ala prasasti; seminar proposal, upacara, budaya"),
  modern: pair("Plus Jakarta Sans", "Plus Jakarta Sans", true, "Modern korporat", "sans tebal rapi; bisnis, keuangan, laporan, manajemen"),
  bulat: pair("Fredoka", "Nunito", true, "Ramah membulat", "huruf bulat bersahabat; tugas kelompok, pendidikan, anak, kesehatan"),
  blok: pair("Archivo Black", "Archivo", false, "Blok tebal", "sangat tebal dan padat; kampanye, olahraga, poster, teknik"),
  poster: pair("Bebas Neue", "Barlow", false, "Poster ramping", "kapital tinggi ramping; berani, modern, data, pemasaran"),
  vintage: pair("Fraunces", "Outfit", true, "Vintage hangat", "serif lembut berkarakter; kertas tua, sejarah, budaya, kuliner"),
  ceria: pair("Lilita One", "Nunito", false, "Ceria tebal", "tebal membulat seperti stiker; scrapbook, tugas kelas, kreatif"),
  tulisan: pair("Caveat", "Nunito", true, "Tulisan tangan", "seperti ditulis tangan; cat air, jurnal, lingkungan, santai"),
  futuristik: pair("Unbounded", "Space Grotesk", true, "Futuristik", "lebar dan teknis; informatika, robotika, sains, startup"),
  nyentrik: pair("Syne", "Manrope", true, "Nyentrik", "unik dan artistik; desain, seni, media, kreatif"),
  retro: pair("Shrikhand", "Outfit", false, "Retro manis", "miring tebal ala 70-an; acara, kuliner, promosi, hiburan"),
  kertas: pair("Gloock", "Mulish", false, "Kertas & kliping", "serif tebal bertinta; kliping, vintage, literasi, arsip"),
} as const satisfies Record<string, FontPair>;

export type FontPairId = keyof typeof FONT_PAIRS;
export const FONT_PAIR_IDS = Object.keys(FONT_PAIRS) as [FontPairId, ...FontPairId[]];
/** Pasangan yang ditawarkan untuk deck baru (font katalog yang tertanam). */
export const CATALOG_PAIR_IDS = FONT_PAIR_IDS.filter((id) => !(SYSTEM_FONTS as readonly string[]).includes(FONT_PAIRS[id].heading));

export function isCatalogFont(font: string): font is CatalogFont {
  return CATALOG_FONTS.some((item) => item.family === font);
}
