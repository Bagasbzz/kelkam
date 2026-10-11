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
  const fontBuffers = await ensureReady();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    background: "#ffffff",
    font: { fontBuffers, defaultFontFamily: "DejaVu Sans", sansSerifFamily: "DejaVu Sans" },
  });
  try {
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
