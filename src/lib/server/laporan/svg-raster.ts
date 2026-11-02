/**
 * Rasterisasi SVG → PNG di server (tanpa browser) memakai resvg (WASM) + font
 * DejaVu yang dibundel, sehingga hasil konsisten di hosting tanpa font sistem.
 */
import { promises as fs } from "fs";
import path from "path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

// Path dibangun manual (bukan require.resolve) agar bundler tidak mencoba mem-bundle .wasm/.ttf.
const NODE_MODULES = path.join(process.cwd(), "node_modules");

let ready: Promise<Uint8Array[]> | null = null;
export const MAX_SVG_DIMENSION = 8192;
export const MAX_SVG_PIXELS = 16 * 1024 * 1024;

export function boundedSvgScale(width: number, height: number, scale: number): number {
  if (![width, height, scale].every((value) => Number.isFinite(value) && value > 0) ||
      width > 32_768 || height > 32_768 || width * height > 64 * 1024 * 1024) {
    throw new Error("Dimensi SVG tidak valid atau melebihi batas.");
  }
  const bounded = Math.min(scale, MAX_SVG_DIMENSION / width, MAX_SVG_DIMENSION / height,
    Math.sqrt(MAX_SVG_PIXELS / (width * height)));
  // Flooring both axes avoids rounding up past the pixel/dimension ceilings.
  return Math.min(Math.max(1, Math.floor(width * bounded)) / width, Math.max(1, Math.floor(height * bounded)) / height);
}

async function ensureReady(): Promise<Uint8Array[]> {
  if (ready) return ready;
  ready = (async () => {
    const wasmPath = path.join(NODE_MODULES, "@resvg", "resvg-wasm", "index_bg.wasm");
    await initWasm(await fs.readFile(wasmPath));
    const fontDir = path.join(NODE_MODULES, "dejavu-fonts-ttf");
    const files = ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf"];
    const buffers: Uint8Array[] = [];
    for (const f of files) {
      const b = await fs.readFile(path.join(fontDir, "ttf", f)).catch(() => null);
      if (b) buffers.push(new Uint8Array(b));
    }
    return buffers;
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

/** SVG string → PNG bytes (skala 2x agar tajam di DOCX). Lempar error bila gagal. */
export async function svgToPngServer(svg: string, scale = 2): Promise<Uint8Array> {
  if (!Number.isFinite(scale) || scale <= 0 || Buffer.byteLength(svg, "utf8") > 2 * 1024 * 1024) {
    throw new Error("Ukuran/skala SVG tidak valid.");
  }
  const fontBuffers = await ensureReady();
  const options = {
    background: "#ffffff",
    font: { fontBuffers, defaultFontFamily: "DejaVu Sans", sansSerifFamily: "DejaVu Sans" },
  };
  const probe = new Resvg(svg, options);
  let bounded: number;
  try {
    bounded = boundedSvgScale(probe.width, probe.height, scale);
  } finally {
    probe.free();
  }
  const resvg = new Resvg(svg, { ...options, fitTo: { mode: "zoom", value: bounded } });
  try {
    const width = Math.ceil(resvg.width * bounded);
    const height = Math.ceil(resvg.height * bounded);
    if (width > MAX_SVG_DIMENSION || height > MAX_SVG_DIMENSION || width * height > MAX_SVG_PIXELS) {
      throw new Error("Hasil raster SVG melebihi batas piksel.");
    }
    const image = resvg.render();
    try {
      return image.asPng();
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
