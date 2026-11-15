/**
 * src/lib/presentation/assets.ts
 * -----------------------------------------------------------------------------
 * Tekstur bawaan desain (dibuat prosedural oleh scripts/build-presentation-assets.ts) yang
 * dipakai sebagai gambar slide dengan fileId "aset:<id>". Berbeda dari unggahan pengguna,
 * file ini disajikan dari /aset-presentasi/ dan dibaca langsung dari disk saat ekspor PPTX.
 */

export const BUILTIN_ASSETS = {
  denim: { width: 1024, height: 1024 },
  gingham: { width: 1024, height: 1024 },
  "catair-1": { width: 1024, height: 1024 },
  "catair-2": { width: 1024, height: 1024 },
  "catair-3": { width: 1024, height: 1024 },
  "kertas-kusut": { width: 1280, height: 720 },
  "kertas-kotak": { width: 1024, height: 1024 },
  "kertas-tua": { width: 1024, height: 1024 },
  glitter: { width: 512, height: 512 },
  koran: { width: 1024, height: 1024 },
} as const;

export type BuiltinAsset = keyof typeof BUILTIN_ASSETS;
const PREFIX = "aset:";

export const builtinFileId = (asset: BuiltinAsset) => `${PREFIX}${asset}`;

export function builtinAssetOf(fileId: string): BuiltinAsset | null {
  if (!fileId.startsWith(PREFIX)) return null;
  const id = fileId.slice(PREFIX.length);
  return Object.hasOwn(BUILTIN_ASSETS, id) ? id as BuiltinAsset : null;
}

/** URL gambar untuk pratinjau: aset bawaan dari folder publik, selain itu file milik pengguna. */
export function imageHref(fileId: string): string {
  const asset = builtinAssetOf(fileId);
  return asset ? `/aset-presentasi/${asset}.png` : `/api/files/${encodeURIComponent(fileId)}`;
}
