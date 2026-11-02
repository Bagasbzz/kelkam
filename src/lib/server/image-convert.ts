/**
 * Konversi gambar server-side (JPEG/GIF/WebP/PNG → PNG) memakai @napi-rs/canvas.
 * Dipakai untuk menyisipkan gambar dari bahan user ke DOCX (exporter hanya PNG)
 * dan memperkecil gambar besar sebelum dikirim ke model vision.
 */
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;

function checkDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("Dimensi/piksel gambar melebihi batas atau tidak valid.");
  }
  return { width, height };
}

/** Inspect encoded headers before any native decoder can allocate pixel memory. */
export function inspectImage(input: Buffer): { mime: string; width: number; height: number } {
  if (input.length > MAX_INPUT_BYTES) throw new Error("Ukuran gambar melebihi batas.");
  const invalid = () => { throw new Error("Header gambar PNG/JPEG/GIF/WebP tidak valid."); };
  if (input.length >= 33 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      input.readUInt32BE(8) === 13 && input.toString("ascii", 12, 16) === "IHDR") {
    const dimensions = checkDimensions(input.readUInt32BE(16), input.readUInt32BE(20));
    let offset = 8;
    let framePixels = 0;
    while (offset + 12 <= input.length) {
      const size = input.readUInt32BE(offset);
      const type = input.toString("ascii", offset + 4, offset + 8);
      if (size > input.length - offset - 12) return invalid();
      if (type === "IHDR" && offset !== 8) return invalid();
      if (type === "acTL") {
        if (size !== 8 || input.readUInt32BE(offset + 8) < 1 ||
            input.readUInt32BE(offset + 8) * dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
          throw new Error("Total piksel frame gambar melebihi batas.");
        }
      }
      if (type === "fcTL") {
        if (size !== 26) return invalid();
        const width = input.readUInt32BE(offset + 12);
        const height = input.readUInt32BE(offset + 16);
        checkDimensions(width, height);
        framePixels += Math.max(width * height, dimensions.width * dimensions.height);
        if (framePixels > MAX_IMAGE_PIXELS) throw new Error("Total piksel frame gambar melebihi batas.");
      }
      if (type === "IEND") return { mime: "image/png", ...dimensions };
      offset += 12 + size;
    }
    return invalid();
  }
  if (input.length >= 13 && /^(GIF87a|GIF89a)$/.test(input.toString("ascii", 0, 6))) {
    const dimensions = checkDimensions(input.readUInt16LE(6), input.readUInt16LE(8));
    let offset = 13 + ((input[10] & 0x80) ? 3 * (1 << ((input[10] & 7) + 1)) : 0);
    let pixels = 0;
    const skipBlocks = () => {
      for (;;) {
        if (offset >= input.length) return invalid();
        const size = input[offset++];
        if (!size) return;
        offset += size;
        if (offset > input.length) return invalid();
      }
    };
    while (offset < input.length) {
      const block = input[offset++];
      if (block === 0x3b) return { mime: "image/gif", ...dimensions };
      if (block === 0x21) { offset++; skipBlocks(); continue; }
      if (block !== 0x2c || offset + 9 > input.length) return invalid();
      const width = input.readUInt16LE(offset + 4);
      const height = input.readUInt16LE(offset + 6);
      checkDimensions(width, height);
      pixels += Math.max(width * height, dimensions.width * dimensions.height);
      if (pixels > MAX_IMAGE_PIXELS) throw new Error("Total piksel frame gambar melebihi batas.");
      const packed = input[offset + 8];
      offset += 9 + ((packed & 0x80) ? 3 * (1 << ((packed & 7) + 1)) : 0);
      offset++; // LZW code size
      skipBlocks();
    }
    return invalid();
  }
  if (input.length >= 4 && input[0] === 0xff && input[1] === 0xd8) {
    let offset = 2;
    let dimensions: { width: number; height: number } | undefined;
    while (offset < input.length) {
      if (input[offset++] !== 0xff) return invalid();
      while (input[offset] === 0xff) offset++;
      const marker = input[offset++];
      if (marker === 0xda || marker === 0xd9) {
        if (!dimensions) return invalid();
        return { mime: "image/jpeg", ...dimensions };
      }
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > input.length) return invalid();
      const size = input.readUInt16BE(offset);
      if (size < 2 || offset + size > input.length) return invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8 || dimensions) return invalid();
        dimensions = checkDimensions(input.readUInt16BE(offset + 5), input.readUInt16BE(offset + 3));
      } else if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return invalid();
      }
      offset += size;
    }
    return invalid();
  }
  if (input.length >= 20 && input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP") {
    if (input.readUInt32LE(4) + 8 !== input.length) return invalid();
    let dimensions: { width: number; height: number } | undefined;
    let bitstream = false;
    let animated = false;
    let framePixels = 0;
    for (let offset = 12; offset + 8 <= input.length;) {
      const type = input.toString("ascii", offset, offset + 4);
      const size = input.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (size > input.length - start) return invalid();
      let current: { width: number; height: number } | undefined;
      if (type === "VP8X") {
        if (size !== 10) return invalid();
        animated = Boolean(input[start] & 2);
        current = checkDimensions(1 + input.readUIntLE(start + 4, 3), 1 + input.readUIntLE(start + 7, 3));
      } else if (type === "VP8 ") {
        if (size < 10 || !input.subarray(start + 3, start + 6).equals(Buffer.from([0x9d, 1, 0x2a]))) return invalid();
        current = checkDimensions(input.readUInt16LE(start + 6) & 0x3fff, input.readUInt16LE(start + 8) & 0x3fff);
        if (bitstream) return invalid();
        bitstream = true;
      } else if (type === "VP8L") {
        if (size < 5 || input[start] !== 0x2f) return invalid();
        const bits = input.readUInt32LE(start + 1);
        current = checkDimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff));
        if (bitstream) return invalid();
        bitstream = true;
      } else if (type === "ANMF") {
        if (!animated || !dimensions || size < 16) return invalid();
        const frame = checkDimensions(1 + input.readUIntLE(start + 6, 3), 1 + input.readUIntLE(start + 9, 3));
        framePixels += Math.max(frame.width * frame.height, dimensions.width * dimensions.height);
        if (framePixels > MAX_IMAGE_PIXELS) throw new Error("Total piksel frame gambar melebihi batas.");
        // Validate the frame's own encoded dimensions, not just its ANMF header.
        const riff = Buffer.alloc(12);
        riff.write("RIFF");
        riff.writeUInt32LE(size - 16 + 4, 4);
        riff.write("WEBP", 8);
        for (let nested = start + 16; nested + 8 <= start + size;) {
          const kind = input.toString("ascii", nested, nested + 4);
          if (!["ALPH", "VP8 ", "VP8L"].includes(kind)) return invalid();
          const length = input.readUInt32LE(nested + 4);
          if (length > start + size - nested - 8) return invalid();
          nested += 8 + length + (length & 1);
        }
        const decoded = inspectImage(Buffer.concat([riff, input.subarray(start + 16, start + size)]));
        if (decoded.width !== frame.width || decoded.height !== frame.height) return invalid();
        bitstream = true;
      }
      if (current) {
        if (dimensions && (current.width !== dimensions.width || current.height !== dimensions.height)) return invalid();
        dimensions = current;
      }
      offset = start + size + (size & 1);
      if (offset > input.length) return invalid();
    }
    if (dimensions && bitstream) return { mime: "image/webp", ...dimensions };
  }
  return invalid();
}

export interface PngResult {
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Ubah gambar apa pun yang didukung menjadi PNG dengan lebar maks `maxWidth`.
 * PNG yang sudah cukup kecil dikembalikan apa adanya (tanpa decode ulang).
 */
export async function toPng(input: Buffer, options: { maxWidth?: number; maxBytesPassthrough?: number } = {}): Promise<PngResult> {
  const header = inspectImage(input);
  const { mime } = header;
  if (options.maxWidth !== undefined && (!Number.isFinite(options.maxWidth) || options.maxWidth <= 0)) throw new Error("Batas lebar gambar tidak valid.");
  const maxWidth = Math.min(4096, Math.max(64, Math.floor(options.maxWidth ?? 1600)));
  const passthrough = options.maxBytesPassthrough ?? 3 * 1024 * 1024;

  if (mime === "image/png" && input.length <= passthrough) {
    const { width, height } = header;
    if (width > 0 && height > 0 && width <= maxWidth) return { bytes: input, width, height };
  }

  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(input);
  checkDimensions(img.width, img.height);
  if (img.width !== header.width || img.height !== header.height) throw new Error("Dimensi gambar tidak cocok dengan header.");
  const scale = Math.min(1, maxWidth / img.width, 4096 / img.height);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Latar putih: gambar transparan (logo/screenshot) tetap terbaca saat dicetak.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return { bytes: await canvas.encode("png"), width, height };
}
