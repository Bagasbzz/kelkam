/**
 * src/lib/presentation/ttf.ts
 * -----------------------------------------------------------------------------
 * Pembaca TrueType minimal (tanpa dependensi) untuk font presentasi milik sendiri:
 * nama keluarga, metrik lebar huruf, dan data OS/2 untuk membungkus font menjadi
 * Embedded OpenType (EOT) yang dipakai PowerPoint sebagai font tertanam (.fntdata).
 * Hanya dipakai untuk file font yang kita sediakan, bukan unggahan pengguna.
 */

export interface TtfInfo {
  family: string;
  subfamily: string;
  fullName: string;
  version: string;
  unitsPerEm: number;
  weight: number;
  italic: boolean;
  fsType: number;
  panose: Uint8Array;
  unicodeRange: [number, number, number, number];
  codePageRange: [number, number];
  checkSumAdjustment: number;
  /** Tinggi baris Windows (PowerPoint memakai usWinAscent + usWinDescent untuk spasi satu baris). */
  winAscent: number;
  winDescent: number;
  /** Lebar maju (satuan font) untuk sebuah code point, atau undefined bila tidak ada glyph. */
  advance(codePoint: number): number | undefined;
}

type Tables = Map<string, { offset: number; length: number }>;

function tables(data: Buffer): Tables {
  if (data.length < 12) throw new Error("File font terlalu pendek.");
  const version = data.readUInt32BE(0);
  if (version !== 0x00010000 && version !== 0x74727565) throw new Error("Hanya font TrueType (.ttf) yang didukung.");
  const count = data.readUInt16BE(4);
  const map: Tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = data.toString("latin1", at, at + 4);
    const offset = data.readUInt32BE(at + 8), length = data.readUInt32BE(at + 12);
    if (offset + length > data.length) throw new Error(`Tabel font ${tag} rusak.`);
    map.set(tag, { offset, length });
  }
  for (const tag of ["head", "hhea", "hmtx", "cmap", "name", "OS/2"]) if (!map.has(tag)) throw new Error(`Tabel font ${tag} tidak ada.`);
  return map;
}

function readNames(data: Buffer, base: number): Map<number, string> {
  const count = data.readUInt16BE(base + 2), strings = base + data.readUInt16BE(base + 4);
  const best = new Map<number, { score: number; value: string }>();
  for (let i = 0; i < count; i++) {
    const at = base + 6 + i * 12;
    const platform = data.readUInt16BE(at), encoding = data.readUInt16BE(at + 2), language = data.readUInt16BE(at + 4);
    const id = data.readUInt16BE(at + 6), length = data.readUInt16BE(at + 8), offset = strings + data.readUInt16BE(at + 10);
    let value: string, score: number;
    if (platform === 3 && (encoding === 1 || encoding === 0)) {
      let decoded = "";
      for (let k = 0; k + 1 < length; k += 2) decoded += String.fromCharCode(data.readUInt16BE(offset + k));
      value = decoded;
      score = language === 0x409 ? 3 : 2;
    } else if (platform === 1 && encoding === 0) {
      value = data.toString("latin1", offset, offset + length);
      score = 1;
    } else continue;
    if ((best.get(id)?.score ?? 0) < score) best.set(id, { score, value });
  }
  return new Map([...best].map(([id, entry]) => [id, entry.value]));
}

function cmapLookup(data: Buffer, base: number): (codePoint: number) => number {
  const count = data.readUInt16BE(base + 2);
  let format4 = -1, format12 = -1;
  for (let i = 0; i < count; i++) {
    const at = base + 4 + i * 8;
    const platform = data.readUInt16BE(at), encoding = data.readUInt16BE(at + 2);
    const offset = base + data.readUInt32BE(at + 4);
    const format = data.readUInt16BE(offset);
    if (format === 12 && (platform === 3 && encoding === 10 || platform === 0)) format12 = offset;
    if (format === 4 && (platform === 3 && encoding === 1 || platform === 0)) format4 = offset;
  }
  if (format12 >= 0) {
    const groups = data.readUInt32BE(format12 + 12);
    return (cp) => {
      for (let i = 0; i < groups; i++) {
        const at = format12 + 16 + i * 12;
        const start = data.readUInt32BE(at), end = data.readUInt32BE(at + 4);
        if (cp >= start && cp <= end) return data.readUInt32BE(at + 8) + cp - start;
      }
      return 0;
    };
  }
  if (format4 < 0) throw new Error("Font tidak punya peta karakter Unicode.");
  const segments = data.readUInt16BE(format4 + 6) / 2;
  const ends = format4 + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segments; i++) {
      if (cp > data.readUInt16BE(ends + i * 2)) continue;
      const start = data.readUInt16BE(starts + i * 2);
      if (cp < start) return 0;
      const delta = data.readInt16BE(deltas + i * 2), range = data.readUInt16BE(ranges + i * 2);
      if (!range) return (cp + delta) & 0xffff;
      const glyph = data.readUInt16BE(ranges + i * 2 + range + (cp - start) * 2);
      return glyph ? (glyph + delta) & 0xffff : 0;
    }
    return 0;
  };
}

export function parseTtf(data: Buffer): TtfInfo {
  const map = tables(data);
  const head = map.get("head")!.offset, hhea = map.get("hhea")!.offset, hmtx = map.get("hmtx")!.offset, os2 = map.get("OS/2")!.offset;
  const names = readNames(data, map.get("name")!.offset);
  const metrics = data.readUInt16BE(hhea + 34);
  const glyphOf = cmapLookup(data, map.get("cmap")!.offset);
  const os2Version = data.readUInt16BE(os2);
  return {
    family: names.get(1) ?? "",
    subfamily: names.get(2) ?? "Regular",
    fullName: names.get(4) ?? names.get(1) ?? "",
    version: names.get(5) ?? "",
    unitsPerEm: data.readUInt16BE(head + 18),
    checkSumAdjustment: data.readUInt32BE(head + 8),
    winAscent: data.readUInt16BE(os2 + 74),
    winDescent: data.readUInt16BE(os2 + 76),
    weight: data.readUInt16BE(os2 + 4),
    fsType: data.readUInt16BE(os2 + 8),
    italic: (data.readUInt16BE(os2 + 62) & 1) === 1,
    panose: new Uint8Array(data.subarray(os2 + 32, os2 + 42)),
    unicodeRange: [data.readUInt32BE(os2 + 42), data.readUInt32BE(os2 + 46), data.readUInt32BE(os2 + 50), data.readUInt32BE(os2 + 54)],
    codePageRange: os2Version >= 1 ? [data.readUInt32BE(os2 + 78), data.readUInt32BE(os2 + 82)] : [1, 0],
    advance(codePoint) {
      const glyph = glyphOf(codePoint);
      if (!glyph) return undefined;
      return data.readUInt16BE(hmtx + Math.min(glyph, metrics - 1) * 4);
    },
  };
}

/**
 * Bungkus TTF menjadi EOT versi 0x00020002 tanpa kompresi (format .fntdata PowerPoint).
 * Struktur header mengikuti spesifikasi W3C "Embedded OpenType (EOT) File Format" dan dicocokkan dengan
 * .fntdata yang ditulis PowerPoint sendiri (versi 2.2, charset 0); semua bidang little-endian.
 */
export function toEot(font: Buffer, info: TtfInfo = parseTtf(font)): Buffer {
  const utf16 = (value: string) => Buffer.from(value, "utf16le");
  const strings = [utf16(info.family), utf16(info.subfamily), utf16(info.version), utf16(info.fullName)];
  const fixed = 80;
  // Padding5 + RootStringSize (kosong), lalu bidang versi 2.2: RootStringCheckSum, EUDCCodePage, Padding6,
  // SignatureSize, EUDCFlags, EUDCFontSize.
  const tail = 4 + 20;
  const size = fixed + strings.reduce((sum, value) => sum + 4 + value.length, 0) + tail + font.length;
  const out = Buffer.alloc(size);
  let at = 0;
  const u32 = (value: number) => { out.writeUInt32LE(value >>> 0, at); at += 4; };
  const u16 = (value: number) => { out.writeUInt16LE(value, at); at += 2; };
  u32(size); u32(font.length); u32(0x00020002); u32(0);
  out.set(info.panose.subarray(0, 10), at); at += 10;
  out.writeUInt8(0, at++); // charset, sama dengan yang ditulis PowerPoint
  out.writeUInt8(info.italic ? 1 : 0, at++);
  u32(info.weight); u16(info.fsType); u16(0x504c);
  info.unicodeRange.forEach(u32); info.codePageRange.forEach(u32);
  u32(info.checkSumAdjustment);
  u32(0); u32(0); u32(0); u32(0);
  for (const value of strings) { u16(0); u16(value.length); value.copy(out, at); at += value.length; }
  u16(0); u16(0); // Padding5 + RootStringSize 0
  u32(0x50475342); // RootStringCheckSum untuk RootString kosong (nilai awal spesifikasi)
  u32(0); u16(0); u16(0); u32(0); u32(0); // EUDCCodePage, Padding6, SignatureSize, EUDCFlags, EUDCFontSize
  font.copy(out, at);
  return out;
}
