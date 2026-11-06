import type { ArtDirection, PresentationPalette, PresentationTheme, ThemeDefinition } from "./model";

export interface DesignPreset {
  id: string;
  label: string;
  description: string;
  theme: PresentationTheme;
  artDirection: ArtDirection;
  palette: PresentationPalette;
}

/** Authored local directions, not external templates or downloadable fonts. */
export const DESIGN_PRESETS: readonly DesignPreset[] = [
  { id: "editorial-clean", label: "Editorial Clean", description: "Serif hangat, bidang geometris, dan ruang lapang untuk cerita riset.", theme: "editorial", palette: "original", artDirection: { style: "geometric", concept: "Atlas editorial dengan kertas hangat, komposisi diagonal dan ilustrasi native yang sederhana." } },
  { id: "coral-zine", label: "Coral Zine", description: "Poster koral, tekstur halftone, dan judul tebal yang ekspresif.", theme: "playful", palette: "sunset", artDirection: { style: "zine", concept: "Kolase poster komunitas dengan tinta koral, bidang kertas jingga dan halftone yang berani." } },
  { id: "midnight-kinetic", label: "Midnight Kinetic", description: "Kanvas malam, aksen lime, dan tipografi monumental.", theme: "product", palette: "original", artDirection: { style: "kinetic", concept: "Panggung produk gelap dengan judul monumental, penanda arah dan jaringan yang bergerak maju." } },
  { id: "tech-blueprint", label: "Tech Blueprint", description: "Grid biru teknik, garis presisi, dan struktur sistem yang jelas.", theme: "product", palette: "original", artDirection: { style: "blueprint", concept: "Cetak biru teknologi dengan grid teknik biru, node jaringan dan anotasi yang terstruktur." } },
  { id: "botanical-forest", label: "Botanical Forest", description: "Hijau hutan, serif organik, dan bidang tenang untuk gagasan berkelanjutan.", theme: "editorial", palette: "forest", artDirection: { style: "geometric", concept: "Atlas botani hijau dengan bidang daun geometris dan ritme editorial yang tenang." } },
  { id: "clean-ocean", label: "Clean Ocean", description: "Putih kebiruan, aksen laut, dan garis minimal untuk pesan jernih.", theme: "playful", palette: "ocean", artDirection: { style: "minimal", concept: "Komposisi bersih dengan ruang putih, garis biru laut dan sedikit elemen visual yang fokus." } },
  { id: "lilac-zine", label: "Lilac Zine", description: "Lavender lembut, tinta ungu, dan kolase kreatif yang berkarakter.", theme: "playful", palette: "lavender", artDirection: { style: "zine", concept: "Zine kreatif lavender dengan judul tinta ungu besar, kolase bidang dan pola titik." } },
  { id: "bold-cobalt", label: "Bold Cobalt", description: "Biru kobalt elektrik dengan tipografi kinetik dan aksen kuning.", theme: "product", palette: "cobalt", artDirection: { style: "kinetic", concept: "Poster kobalt elektrik dengan judul monumental putih dan penanda arah kuning kontras." } },
  { id: "rose-editorial", label: "Rose Editorial", description: "Kertas merah muda, serif anggur, dan komposisi majalah yang lembut.", theme: "editorial", palette: "rose", artDirection: { style: "geometric", concept: "Majalah editorial bernuansa rose dengan bidang merah muda, serif anggur dan garis halus." } },
  { id: "mono-minimal", label: "Mono Minimal", description: "Hitam putih, garis sederhana, dan kontras tajam tanpa distraksi.", theme: "editorial", palette: "mono", artDirection: { style: "minimal", concept: "Editorial monokrom dengan ruang putih luas, garis hitam dan hierarki tipografi sederhana." } },
];

type ColorTokens = Pick<ThemeDefinition, "background" | "foreground" | "muted" | "accent" | "secondary" | "surface">;
export const PALETTES: Record<Exclude<PresentationPalette, "original">, ColorTokens> = {
  ocean: { background: "EEF8FA", foreground: "123744", muted: "42656F", accent: "007B91", secondary: "B9E1E8", surface: "DCEEF2" },
  sunset: { background: "FFF0DE", foreground: "482624", muted: "785049", accent: "BF362F", secondary: "F6AD7D", surface: "F9D9BC" },
  lavender: { background: "F4EEFF", foreground: "32214D", muted: "6C567F", accent: "7041AB", secondary: "D3B8F0", surface: "E5D8F5" },
  forest: { background: "EFF4E7", foreground: "203A2B", muted: "526A52", accent: "32633D", secondary: "BED0A7", surface: "DEE8D2" },
  mono: { background: "FAFAFA", foreground: "171717", muted: "606060", accent: "242424", secondary: "D5D5D5", surface: "EBEBEB" },
  cobalt: { background: "173CB8", foreground: "FFFFFF", muted: "D4DEFF", accent: "FFE56B", secondary: "4966CD", surface: "294BBB" },
  rose: { background: "FFF0F3", foreground: "512839", muted: "815565", accent: "A13157", secondary: "EDB7C7", surface: "F7DAE3" },
};
