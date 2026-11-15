/**
 * src/lib/presentation/kit-shapes.ts
 * -----------------------------------------------------------------------------
 * Bentuk vektor dekorasi ala template desainer: tepi sobek, zig-zag, perangko, daun,
 * bintang, kilau, kancing, spiral, panah coretan, gelombang kontur, kupu-kupu, klip kertas.
 * Semua titik dinormalisasi 0..1 terhadap kotaknya (seperti polygon lain di renderer),
 * dibuat di sini dari seed deck, tidak pernah dari model AI.
 */

export type Pt = readonly [number, number];
export type Pts = readonly Pt[];
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const norm = (points: [number, number][], w: number, h: number): Pts => points.map(([x, y]) => [r3(x / w), r3(y / h)] as const);

/** Persegi panjang membulat; radius per sudut (inci): kiri-atas, kanan-atas, kanan-bawah, kiri-bawah. */
export function roundRect(w: number, h: number, radius: number | [number, number, number, number]): Pts {
  const [tl, tr, br, bl] = (Array.isArray(radius) ? radius : [radius, radius, radius, radius]).map((r) => Math.max(0, Math.min(r, w / 2, h / 2)));
  const pts: [number, number][] = [];
  const corner = (cx: number, cy: number, r: number, from: number) => {
    for (let i = 0; i <= 8; i++) { const a = from + (Math.PI / 2) * (i / 8); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  // Sudut tanpa radius langsung memakai titik sudutnya.
  if (tr > 0.001) corner(w - tr, tr, tr, -Math.PI / 2); else pts.push([w, 0]);
  if (br > 0.001) corner(w - br, h - br, br, 0); else pts.push([w, h]);
  if (bl > 0.001) corner(bl, h - bl, bl, Math.PI / 2); else pts.push([0, h]);
  if (tl > 0.001) corner(tl, tl, tl, Math.PI); else pts.push([0, 0]);
  return norm(pts, w, h);
}

/** Tepi zig-zag di sisi yang dipilih (gigi gergaji kain/denim). */
export function zigzagRect(w: number, h: number, tooth: number, sides: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } = { top: true, right: true, bottom: true, left: true }): Pts {
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, on: boolean, inward: [number, number]) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = on ? Math.max(2, Math.round(len / tooth)) : 1;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      if (on) { const m = (i + 0.5) / n; pts.push([x0 + (x1 - x0) * m + inward[0] * tooth * 0.55, y0 + (y1 - y0) * m + inward[1] * tooth * 0.55]); }
    }
  };
  edge(0, 0, w, 0, !!sides.top, [0, 1]);
  edge(w, 0, w, h, !!sides.right, [-1, 0]);
  edge(w, h, 0, h, !!sides.bottom, [0, -1]);
  edge(0, h, 0, 0, !!sides.left, [1, 0]);
  return norm(pts, w, h);
}

/** Tepi sobek tidak beraturan (kertas disobek tangan). */
export function tornRect(rand: () => number, w: number, h: number, amp = 0.08, step = 0.12, sides: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean } = { top: true, right: true, bottom: true, left: true }): Pts {
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, on: boolean, inward: [number, number]) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = on ? Math.max(3, Math.round(len / step)) : 1;
    let drift = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      drift = on ? Math.max(0, Math.min(1, drift * 0.6 + rand() * 0.7)) : 0;
      const d = on && i > 0 ? drift * amp : 0;
      pts.push([x0 + (x1 - x0) * t + inward[0] * d, y0 + (y1 - y0) * t + inward[1] * d]);
    }
  };
  edge(0, 0, w, 0, !!sides.top, [0, 1]);
  edge(w, 0, w, h, !!sides.right, [-1, 0]);
  edge(w, h, 0, h, !!sides.bottom, [0, -1]);
  edge(0, h, 0, 0, !!sides.left, [1, 0]);
  return norm(pts, w, h);
}

/** Tepi perangko: lekukan setengah lingkaran ke dalam di sepanjang tepi. */
export function stampRect(w: number, h: number, bump = 0.14): Pts {
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, inward: [number, number]) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / (bump * 2)));
    const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    for (let i = 0; i < n; i++) {
      const cx = x0 + ux * len * (i + 0.5) / n, cy = y0 + uy * len * (i + 0.5) / n;
      const r = len / n / 2;
      for (let k = 0; k <= 6; k++) {
        const a = Math.PI * k / 6;
        // Setengah lingkaran menjorok ke dalam.
        pts.push([cx - ux * r * Math.cos(a) + inward[0] * r * Math.sin(a) * 0.7, cy - uy * r * Math.cos(a) + inward[1] * r * Math.sin(a) * 0.7]);
      }
    }
  };
  edge(0, 0, w, 0, [0, 1]); edge(w, 0, w, h, [-1, 0]); edge(w, h, 0, h, [0, -1]); edge(0, h, 0, 0, [1, 0]);
  return norm(pts, w, h);
}

/** Tepi bergelombang lembut (tepi kartu cat air / awan). */
export function wobbleRect(rand: () => number, w: number, h: number, amp = 0.08, waves = 9): Pts {
  const pts: [number, number][] = [];
  const phase = rand() * Math.PI * 2;
  const total = 2 * (w + h);
  const steps = 120;
  for (let i = 0; i < steps; i++) {
    let d = (i / steps) * total;
    let x: number, y: number, nx: number, ny: number;
    if (d < w) { x = d; y = 0; nx = 0; ny = 1; } else if ((d -= w) < h) { x = w; y = d; nx = -1; ny = 0; } else if ((d -= h) < w) { x = w - d; y = h; nx = 0; ny = -1; } else { d -= w; x = 0; y = h - d; nx = 1; ny = 0; }
    const off = amp * (0.5 + 0.5 * Math.sin((i / steps) * Math.PI * 2 * waves + phase)) * (0.7 + rand() * 0.3);
    pts.push([x + nx * off, y + ny * off]);
  }
  return norm(pts, w, h);
}

export function star(points = 5, inner = 0.45, rotation = -Math.PI / 2): Pts {
  const pts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner * 0.5 : 0.5, a = rotation + (Math.PI * i) / points;
    pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
  }
  return pts.map(([x, y]) => [r3(x), r3(y)] as const);
}

/** Kilau 4 sudut dengan sisi melengkung ke dalam. */
export function sparkle(): Pts {
  const pts: [number, number][] = [];
  for (let q = 0; q < 4; q++) {
    const a0 = (Math.PI / 2) * q - Math.PI / 2;
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (Math.PI / 2) * (k / 8);
      // Kurva kuartik: tajam di ujung, ramping di tengah.
      const r = 0.44 * Math.pow(Math.abs(Math.cos(2 * (a - a0))), 3) + 0.06;
      pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
    }
  }
  return pts.map(([x, y]) => [r3(x), r3(y)] as const);
}

export function circle(n = 40): Pts {
  return Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n; return [r3(0.5 + 0.5 * Math.cos(a)), r3(0.5 + 0.5 * Math.sin(a))] as const; });
}

/** Bentuk bunga/daun semanggi 4 kelopak (bingkai foto kliping). */
export function flower(petals = 4, depth = 0.18): Pts {
  return Array.from({ length: 96 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 96;
    const r = 0.5 - depth * 0.5 * (1 - Math.abs(Math.cos(petals * a / 2)));
    return [r3(0.5 + r * Math.cos(a)), r3(0.5 + r * Math.sin(a))] as const;
  });
}

/** Spiral terbuka (ornamen ulir). */
export function spiral(turns = 2.2): Pts {
  return Array.from({ length: 60 }, (_, i) => {
    const t = i / 59, a = t * turns * Math.PI * 2, r = 0.5 * (1 - t * 0.85);
    return [r3(0.5 + r * Math.cos(a)), r3(0.5 + r * Math.sin(a))] as const;
  });
}

/** Panah coretan melengkung, garis terbuka berakhir di kepala panah (kanan). */
export function curvedArrow(): Pts {
  const body: [number, number][] = Array.from({ length: 24 }, (_, i) => { const t = i / 23; return [0.04 + t * 0.9, 0.75 - Math.sin(t * Math.PI) * 0.6]; });
  const [ex, ey] = body[body.length - 1];
  return [...body, [ex - 0.16, ey - 0.12], [ex, ey], [ex - 0.06, ey + 0.2]].map(([x, y]) => [r3(x), r3(y)] as const);
}

/** Gelombang (sinus) terbuka dalam kotaknya. */
export function wave(cycles = 2, phase = 0, amp = 0.5): Pts {
  return Array.from({ length: 64 }, (_, i) => { const t = i / 63; return [r3(t), r3(0.5 + amp * 0.5 * Math.sin(phase + t * Math.PI * 2 * cycles))] as const; });
}

/** Kupu-kupu sederhana (dua sayap). */
export function butterfly(): Pts {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (Math.PI * 2 * i) / 64;
    const r = Math.exp(Math.sin(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin((2 * t - Math.PI) / 24), 5);
    pts.push([0.5 + 0.11 * r * Math.sin(t), 0.62 - 0.11 * r * Math.cos(t)]);
  }
  return pts.map(([x, y]) => [r3(Math.max(0, Math.min(1, x))), r3(Math.max(0, Math.min(1, y)))] as const);
}

/** Klip kertas (garis terbuka). */
export function paperclip(): Pts {
  return [[0.7, 0.3], [0.7, 0.85], [0.6, 0.97], [0.5, 1], [0.4, 0.97], [0.3, 0.85], [0.3, 0.12], [0.38, 0.02], [0.5, 0], [0.62, 0.02], [0.6, 0.02], [0.66, 0.1], [0.66, 0.75], [0.6, 0.85], [0.5, 0.88], [0.42, 0.85], [0.4, 0.75], [0.4, 0.25]]
    .map(([x, y]) => [x, y] as const);
}

/** Putar titik ternormalisasi di dalam kotak (inci), hasil dinormalisasi ke kotak pembungkus baru. */
export function rotated(points: Pts, w: number, h: number, degrees: number): { points: Pts; w: number; h: number; dx: number; dy: number } {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const abs = points.map(([x, y]) => { const px = (x - 0.5) * w, py = (y - 0.5) * h; return [px * c - py * s, px * s + py * c] as [number, number]; });
  const xs = abs.map((p) => p[0]), ys = abs.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const nw = maxX - minX, nh = maxY - minY;
  return { points: abs.map(([x, y]) => [r3((x - minX) / nw), r3((y - minY) / nh)] as const), w: nw, h: nh, dx: (w - nw) / 2, dy: (h - nh) / 2 };
}
