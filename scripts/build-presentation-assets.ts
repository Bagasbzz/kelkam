/**
 * scripts/build-presentation-assets.ts
 * -----------------------------------------------------------------------------
 * Membuat tekstur bawaan desain presentasi secara prosedural (tanpa gambar pihak ketiga):
 * denim, kotak-kotak gingham, noda cat air, kertas kusut, kertas kotak, koran, glitter, kertas tua.
 * Semua tekstur abu-abu (gelap = warna utama, terang = warna latar); warnanya diberikan saat render
 * lewat efek duotone (SVG feColorMatrix di pratinjau, <a:duotone> di PowerPoint), jadi mengikuti
 * warna pilihan pengguna. Hasil: public/aset-presentasi/<id>.png
 * Jalankan ulang bila tekstur diubah: npx tsx scripts/build-presentation-assets.ts
 */
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve(__dirname, "..", "public", "aset-presentasi");

// --- noise ------------------------------------------------------------------
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function valueNoise(seed: number, size = 256) {
  const r = rng(seed);
  const grid = Float32Array.from({ length: size * size }, () => r());
  const at = (x: number, y: number) => grid[((y % size + size) % size) * size + ((x % size + size) % size)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}
function fbm(seed: number) {
  const layers = [0, 1, 2, 3, 4].map((i) => valueNoise(seed + i * 101));
  return (x: number, y: number, octaves = 5) => {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) { sum += layers[i](x * freq, y * freq) * amp; norm += amp; amp *= 0.5; freq *= 2; }
    return sum / norm;
  };
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));

async function save(id: string, w: number, h: number, pixel: (x: number, y: number) => [number, number]) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [gray, alpha] = pixel(x, y);
    const i = (y * w + x) * 4, g = Math.round(clamp(gray) * 255);
    img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = Math.round(clamp(alpha) * 255);
  }
  ctx.putImageData(img, 0, 0);
  await writeFile(path.join(outDir, `${id}.png`), await canvas.encode("png"));
  console.log(`${id}.png ${w}x${h}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  // Denim: tenunan twill diagonal yang terlihat pada ukuran slide, benang lusi, bercak pudar (gelap = warna utama).
  {
    const n = fbm(11), fine = valueNoise(12, 512);
    await save("denim", 1024, 1024, (x, y) => {
      const phase = ((x + y * 0.6) / 7) % 1;
      const twill = phase < 0.55 ? 1 : 0;
      const thread = fine(x * 0.35, y * 0.05) * 0.6 + fine(x * 0.8, y * 0.1) * 0.4;
      const worn = Math.max(0, n(x / 260, y / 260) - 0.5) * 1.5;
      const speck = fine(x * 2.3, y * 2.3);
      return [0.16 + twill * 0.16 + thread * 0.2 + worn * 0.5 + (speck > 0.94 ? 0.2 : 0), 1];
    });
  }

  // Gingham cat air: pita horizontal dan vertikal transparan dengan tepi lembut (seperti dicat).
  {
    const n = fbm(21);
    const band = (v: number) => { const t = ((v % 128) + 128) % 128; return 0.5 - 0.5 * Math.tanh((Math.abs(t - 32) - 30) / 3); };
    await save("gingham", 1024, 1024, (x, y) => {
      const wobble = (n(x / 120, y / 120) - 0.5) * 8;
      const hx = band(x + wobble), hy = band(y - wobble);
      const wash = (n(x / 40, y / 40) - 0.5) * 0.1;
      return [1 - clamp(hx * 0.32 + hy * 0.32 + hx * hy * 0.16 + wash), 1];
    });
  }

  // Noda cat air (3 variasi): tepi organik berfrekuensi rendah, pigmen menumpuk tipis di tepi, isi halus bergradasi.
  for (const [i, seed] of [[1, 31], [2, 37], [3, 41]] as const) {
    const n = fbm(seed), g = valueNoise(seed + 5, 512);
    await save(`catair-${i}`, 1024, 1024, (x, y) => {
      const dx = (x - 512) / 512, dy = (y - 512) / 512;
      const dist = Math.hypot(dx * 1.05, dy) + (n(x / 260, y / 260, 3) - 0.5) * 0.55 + (n(x / 70, y / 70, 2) - 0.5) * 0.08;
      const edge = 0.74 - dist;
      if (edge <= 0) return [1, 0];
      const alpha = clamp(edge * 40);
      const rim = Math.exp(-(edge ** 2) / 0.0012) * 0.22;
      const grain = (g(x * 1.2, y * 1.2) - 0.5) * 0.06;
      const tone = 0.5 + (n(x / 220, y / 220, 3) - 0.5) * 0.45 - rim + grain;
      return [tone, alpha * 0.92];
    });
  }

  // Kertas kusut: banyak lipatan kecil dengan bayangan lembut (dominan terang).
  {
    const r = rng(51), n = fbm(52);
    const folds = Array.from({ length: 90 }, () => ({ x: r() * 1280, y: r() * 720, a: r() * Math.PI, k: (r() - 0.5) * 0.045, w: 4 + r() * 10 }));
    await save("kertas-kusut", 1280, 720, (x, y) => {
      let v = 0.9;
      for (const f of folds) {
        const d = (x - f.x) * Math.cos(f.a) + (y - f.y) * Math.sin(f.a);
        v += f.k * Math.tanh(d / f.w);
      }
      return [v + (n(x / 6, y / 6) - 0.5) * 0.04, 1];
    });
  }

  // Kertas bergaris kotak (buku catatan).
  {
    const n = valueNoise(61, 512);
    await save("kertas-kotak", 1024, 1024, (x, y) => {
      const line = x % 42 < 2 || y % 42 < 2 ? 0.25 : 0;
      return [0.97 - line + (n(x * 0.8, y * 0.8) - 0.5) * 0.04, 1];
    });
  }

  // Kertas tua: bintik dan noda halus (latar kartu vintage).
  {
    const n = fbm(71), s = valueNoise(72, 512);
    await save("kertas-tua", 1024, 1024, (x, y) => {
      const stain = Math.max(0, n(x / 180, y / 180) - 0.5) * 0.5;
      const speck = s(x * 1.9, y * 1.9) > 0.9 ? 0.18 : 0;
      return [0.97 - stain - speck - (n(x / 12, y / 12) - 0.5) * 0.06, 1];
    });
  }

  // Glitter: bintik terang berkilau di atas dasar gelap.
  {
    const r = rng(81), n = valueNoise(82, 512);
    const dots = Array.from({ length: 2600 }, () => ({ x: r() * 512, y: r() * 512, s: 0.6 + r() * 2.4, v: 0.6 + r() * 0.4 }));
    const grid = new Map<string, typeof dots>();
    for (const d of dots) { const k = `${Math.floor(d.x / 16)},${Math.floor(d.y / 16)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(d); }
    await save("glitter", 512, 512, (x, y) => {
      let v = 0.35 + (n(x * 0.5, y * 0.5) - 0.5) * 0.25;
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) for (const d of grid.get(`${Math.floor(x / 16) + gx},${Math.floor(y / 16) + gy}`) ?? []) {
        const dist = Math.hypot(x - d.x, y - d.y);
        if (dist < d.s) v = Math.max(v, d.v * (1 - dist / d.s) + 0.3);
      }
      return [v, 1];
    });
  }

  // Koran: kolom teks samar (blok garis abu-abu) di atas kertas.
  {
    const canvas = createCanvas(1024, 1024);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#F2F2F2"; ctx.fillRect(0, 0, 1024, 1024);
    const r = rng(91);
    const words = ["the", "camera", "involves", "dismantling", "flame", "moving", "parts", "adjustable", "and", "of", "a", "light", "vital", "gegeste", "lies", "in", "your", "shutter", "cleaning", "as", "well"];
    ctx.fillStyle = "#555555";
    for (let col = 0; col < 3; col++) {
      for (let line = 0; line < 46; line++) {
        let x = 16 + col * 340, text = "";
        while (text.length < 34) text += `${words[Math.floor(r() * words.length)]} `;
        ctx.font = `${19 + (line === 0 ? 8 : 0)}px Georgia`;
        ctx.fillText(text.trim(), x, 34 + line * 21.5, 320);
        x += 0;
      }
    }
    await writeFile(path.join(outDir, "koran.png"), await canvas.encode("png"));
    console.log("koran.png 1024x1024");
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
