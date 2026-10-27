/**
 * src/lib/uml/theme.ts
 * -----------------------------------------------------------------------------
 * Satu sumber geometri + tipografi diagram UML. Dipakai oleh layout
 * (diagram-guard, pipeline), sizing node (node-size), auto-fit teks (text-fit),
 * routing edge (edge-route), renderer editor (components/diagram/*) dan
 * renderer SVG laporan (render-svg). Mengubah angka di sini mengubah editor
 * DAN hasil DOCX sekaligus, sehingga keduanya tidak lagi bisa berbeda.
 *
 * Patokan ukuran: diagram ditempel ke Word dengan lebar area teks ±529 px
 * (A4, margin 4-3 cm) dan tinggi maksimum ±618 px. Ukuran cetak teks ≈
 * fontPx × min(1, 529/lebarViewBox, 618/tinggiViewBox) × 0,75 pt. Karena itu
 * geometri dibuat rapat dan font dibuat besar.
 * -----------------------------------------------------------------------------
 */

// ---------------------------------------------------------------------------
// Tipografi
// ---------------------------------------------------------------------------

export const FONT_FAMILY = "Inter, 'Segoe UI', Arial, sans-serif";

/** Font label di dalam bentuk: auto-fit memilih yang terbesar di rentang ini. */
export const FIT_MAX_FONT = 26;
export const FIT_MIN_FONT = 13;
/** Plafon seragam per diagram tidak pernah diturunkan di bawah angka ini. */
export const UNIFORM_FLOOR = 16;
/** Kepala lifeline sengaja sedikit lebih kecil (nama participant bold). */
export const LIFELINE_MAX_FONT = 20;
/**
 * Font yang DIJAMIN muat saat node dibuat (node-size.ts menghitung ukuran
 * minimal agar label muat di font ini). Auto-fit boleh naik sampai FIT_MAX_FONT.
 */
export const NODE_TARGET_FONT = 24;
export const LIFELINE_TARGET_FONT = 18;

/** Label di luar bentuk (actor, fork/join). */
export const OUTSIDE_FONT = 17;
export const OUTSIDE_LINE_HEIGHT = 21;
export const OUTSIDE_LABEL_GAP = 15;

/** Label edge flowchart/activity/use case ("Ya", "Tidak", …). */
export const EDGE_LABEL_FONT = 20;
/** Label pesan sequence (bold, boleh 2 baris). */
export const SEQ_MESSAGE_FONT = 15;
export const EDGE_LABEL_LINE_RATIO = 1.2;
export const EDGE_LABEL_PAD_X = 6;
export const EDGE_LABEL_PAD_Y = 3;

/** Judul lane (bold); turun sampai LANE_TITLE_MIN_FONT bila nama lane panjang. */
export const LANE_TITLE_FONT = 22;
export const LANE_TITLE_MIN_FONT = 13;

// ---------------------------------------------------------------------------
// Swimlane (activity / flowchart ber-lane)
// ---------------------------------------------------------------------------

/**
 * Lebar lane diagram baru. Diagram activity dibatasi TINGGI halaman (618 px),
 * bukan lebar → lane lebar membuat label lebih sedikit baris, node lebih
 * pendek, dan skala cetak lebih besar (lihat laporan uji di PR).
 */
export const LANE_WIDTH = 320;
/** Lebar lane diagram lama (tersimpan sebelum tema ini) → dipakai untuk kompatibilitas. */
export const LEGACY_LANE_WIDTH = 420;
export const LANE_START_X = 20;
export const LANE_TOP_Y = 24;
export const LANE_HEADER_HEIGHT = 44;
/** Jarak aman node ke garis lane. */
export const LANE_PAD = 12;
/** Lebar maksimum node di dalam lane. */
export const LANE_NODE_MAX_WIDTH = LANE_WIDTH - LANE_PAD * 2;

// ---------------------------------------------------------------------------
// Layout flowchart / activity
// ---------------------------------------------------------------------------

/** Baris pertama node: tepat di bawah kepala lane + sedikit ruang. */
export const FLOW_TOP_Y = LANE_TOP_Y + LANE_HEADER_HEIGHT + 22;
/** Jarak vertikal antar layer (cukup untuk panah + label "Ya/Tidak"). */
export const ROW_GAP = 36;
/** Jarak horizontal node se-layer dalam satu lane/kolom. */
export const SIBLING_GAP = 22;
/** Jarak vertikal node yang ditumpuk karena tidak muat berdampingan. */
export const STACK_GAP = 22;
/** Geser ke bawah saat collision pass. */
export const COLLISION_PUSH = 30;
/** Lebar maksimum node aksi/keputusan (≤ lebar lane − 2×LANE_PAD). */
export const NODE_MAX_WIDTH = 220;
/** Ukuran minimum node per bentuk. */
export const NODE_MIN = {
  rect: { width: 120, height: 48 },
  decision: { width: 132, height: 76 },
  terminator: { width: 96, height: 44 },
  usecase: { width: 140, height: 60 },
} as const;
/** Ruang napas di luar area teks wajib (px, total kiri+kanan / atas+bawah). */
export const NODE_SLACK = { x: 12, y: 8 } as const;
/** Jarak antar kolom cabang flowchart tanpa lane (≥ NODE_MAX_WIDTH + 16 agar tidak dianggap bertumpuk). */
export const BRANCH_COLUMN = 240;
/** Pusat kolom tengah flowchart tanpa lane. */
export const FLOW_CENTER_X = 400;

// ---------------------------------------------------------------------------
// Layout use case
// ---------------------------------------------------------------------------

export const USECASE_CENTER_X = 380;
export const USECASE_TOP_Y = 110;
export const USECASE_GAP = 28;
export const USECASE_MAX_WIDTH = 260;
export const ACTOR_LEFT_X = 90;
export const ACTOR_RIGHT_X = 640;
export const ACTOR_TOP_Y = 90;
export const ACTOR_GAP = 32;

// ---------------------------------------------------------------------------
// Layout sequence
// ---------------------------------------------------------------------------

export const SEQ_START_X = 40;
export const SEQ_TOP_Y = 40;
/** Jarak antar pusat lifeline dihitung dari SEQ_SPAN lalu dijepit ke [MIN, MAX]. */
export const SEQ_GAP_MIN = 150;
export const SEQ_GAP_MAX = 170;
export const SEQ_SPAN = 600;
/** Jarak vertikal antar pesan. */
export const SEQ_ROW_GAP = 54;
/** Jarak kepala lifeline → pesan pertama (memberi ruang label 2 baris). */
export const SEQ_FIRST_MESSAGE_OFFSET = 50;
/** Sisa garis lifeline di bawah pesan terakhir. */
export const SEQ_TAIL = 36;
/** Lebar minimum kotak label pesan sebelum di-wrap. */
export const SEQ_LABEL_MIN_WIDTH = 180;
export const LIFELINE_HEADER_HEIGHT = 56;
export const LIFELINE_MIN_WIDTH = 104;

/** Jarak antar pusat lifeline untuk `count` participant. */
export function sequenceGap(count: number): number {
  const n = Math.max(count, 2);
  return Math.max(SEQ_GAP_MIN, Math.min(SEQ_GAP_MAX, Math.floor(SEQ_SPAN / (n - 1))));
}

/** y pesan ke-`index` (0-based) untuk lifeline yang berawal di SEQ_TOP_Y. */
export function sequenceMessageY(index: number): number {
  return SEQ_TOP_Y + LIFELINE_HEADER_HEIGHT + SEQ_FIRST_MESSAGE_OFFSET + index * SEQ_ROW_GAP;
}

/** Tinggi total lifeline untuk `messageCount` pesan. */
export function sequenceLifelineHeight(messageCount: number): number {
  return LIFELINE_HEADER_HEIGHT + SEQ_FIRST_MESSAGE_OFFSET + Math.max(messageCount - 1, 0) * SEQ_ROW_GAP + SEQ_TAIL;
}

// --- Simbol sequence lanjutan (lihat sequence-layout.ts & sequence-shapes.ts) ---

/** Self-message: lebar & tinggi loop di kanan lifeline. */
export const SEQ_SELF_LOOP_W = 34;
export const SEQ_SELF_LOOP_H = 24;
/** Jarak garis pesan sebelumnya → garis self-message (label di samping loop, bukan di atas). */
export const SEQ_SELF_OFFSET = 36;
/** Activation bar (execution specification). */
export const ACTIVATION_WIDTH = 12;
/** Geser horizontal tiap tingkat activation bersarang. */
export const ACTIVATION_NEST = 6;
export const ACTIVATION_MIN_HEIGHT = 16;
export const ACTIVATION_FILL = "#e2e8f0";
/** Combined fragment (alt/opt/loop/…). */
export const FRAGMENT_FONT = 14;
export const FRAGMENT_TAG_HEIGHT = 22;
/** Ruang vertikal untuk tag + guard di atas pesan pertama fragment. */
export const FRAGMENT_HEADER = 30;
/** Ruang vertikal pemisah operand (else) + guard-nya. */
export const FRAGMENT_GUARD_ROW = 24;
export const FRAGMENT_BOTTOM = 12;
/** Jarak tepi fragment dari pusat lifeline terluar; berkurang per tingkat bersarang. */
export const FRAGMENT_PAD = 46;
export const FRAGMENT_NEST_STEP = 10;
export const FRAGMENT_DASH = "6,4";
/** Note & ref (interaction use). */
export const NOTE_FONT = 15;
export const NOTE_MAX_TEXT_WIDTH = 210;
export const NOTE_PAD_X = 10;
export const NOTE_PAD_Y = 7;
export const NOTE_FOLD = 10;
export const NOTE_FILL = "#fefce8";
/** Lebar ekstra di kiri/kanan pusat lifeline saat note/ref membentang beberapa lifeline. */
export const NOTE_SPAN_PAD = 26;
/** Jarak vertikal sebelum & sesudah note/ref. */
export const NOTE_GAP = 10;
/** Ikon participant (actor/boundary/control/entity/database) di atas nama. */
export const PARTICIPANT_ICON_HEIGHT = 32;
/** Setengah ukuran tanda X destroy. */
export const DESTROY_SIZE = 9;

// ---------------------------------------------------------------------------
// Garis, warna, panah
// ---------------------------------------------------------------------------

export const INK = "#1e293b";
export const EDGE_STROKE = "#334155";
export const EDGE_DASHED_STROKE = "#94a3b8";
export const LIFELINE_STROKE = "#475569";
export const LANE_STROKE = "#94a3b8";
export const LANE_FILL_EVEN = "#ffffff";
export const LANE_FILL_ODD = "#f8fafc";
export const LANE_HEADER_FILL = "#f8fafc";
export const LABEL_BORDER = "#cbd5e1";
export const NODE_STROKE_WIDTH = 1.5;
export const EDGE_STROKE_WIDTH = 2.4;
export const LANE_STROKE_WIDTH = 1.5;
export const EDGE_DASH = "6,5";
export const LIFELINE_DASH = "8,6";
export const LIFELINE_STROKE_WIDTH = 2;
export const ARROW = { width: 10, height: 7, refX: 9, refY: 3.5, points: "0 0, 10 3.5, 0 7" } as const;
/** Panah terbuka (pesan async / return / create) – digambar sebagai garis, bukan segitiga. */
export const ARROW_OPEN = { width: 11, height: 9, refX: 10, refY: 4.5, path: "M 1 1 L 10 4.5 L 1 8" } as const;
export const GRID_STEP = 4;

/** Jarak rute edge balik (loop) dari sisi node terluar. */
export const LOOP_OFFSET = 36;

// ---------------------------------------------------------------------------
// Ekspor SVG
// ---------------------------------------------------------------------------

export const SVG_PADDING = 20;
export const SVG_MIN_WIDTH = 360;
export const SVG_MIN_HEIGHT = 160;

// ---------------------------------------------------------------------------
// Kompatibilitas lebar lane
// ---------------------------------------------------------------------------

interface LaneNodeLike {
  lane?: string;
  x: number;
  width: number;
  offsetX?: number;
}

/**
 * Lebar lane yang dipakai untuk menggambar background lane.
 * - `explicit` (meta.laneWidth tersimpan) selalu menang.
 * - Tanpa itu (diagram lama): pilih kandidat (baru vs 420) yang paling banyak
 *   menaruh node di dalam kotak lane-nya. Seri → lebar baru.
 */
export function resolveLaneWidth(nodes: LaneNodeLike[], lanes: string[], explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 80 && explicit <= 2000) return explicit;
  if (!lanes.length) return LANE_WIDTH;
  const score = (width: number) => {
    let centered = 0;
    let contained = 0;
    for (const node of nodes) {
      const index = node.lane ? lanes.indexOf(node.lane) : -1;
      if (index < 0) continue;
      const left = LANE_START_X + index * width;
      const x = node.x + (node.offsetX || 0);
      const cx = x + node.width / 2;
      if (cx >= left && cx <= left + width) centered += 1;
      if (x >= left && x + node.width <= left + width) contained += 1;
    }
    return centered * 1000 + contained;
  };
  return score(LEGACY_LANE_WIDTH) > score(LANE_WIDTH) ? LEGACY_LANE_WIDTH : LANE_WIDTH;
}
