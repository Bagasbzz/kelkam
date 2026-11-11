import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { costLimitMessage, DEFAULT_AI_COST_CONFIG, estimateCallRupiah, exceededPeriod, normalizeAiCostConfig, periodStarts, rupiahFor } from "../src/lib/server/ai-cost.ts";
import { getErrorMessage } from "../src/lib/errors.ts";

test("config dari panel divalidasi: kosong/0 = tanpa batas, nilai aneh jatuh ke bawaan", () => {
  const config = normalizeAiCostConfig({
    enabled: true, usdToIdr: "1000", global: { day: 50000, week: "", month: 0 }, perUser: { day: -5, week: "20.000", month: 100000 },
    prices: { "claude-sonnet-5": { input: 2, output: 10 }, "deepseek-v4-pro": { input: "0.5", output: "abc" } }, defaultPrice: {}, imagePriceUsd: null,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.usdToIdr, 1000);
  assert.deepEqual(config.global, { day: 50000, week: null, month: null });
  assert.deepEqual(config.perUser, { day: null, week: 20000, month: 100000 });
  assert.deepEqual(config.prices["deepseek-v4-pro"], { input: 0.5, output: DEFAULT_AI_COST_CONFIG.defaultPrice.output });
  assert.equal(config.imagePriceUsd, DEFAULT_AI_COST_CONFIG.imagePriceUsd);
  assert.equal(normalizeAiCostConfig(null).enabled, false);
});

test("rupiah dihitung dari token x harga model x kurs (1 USD = Rp1.000)", () => {
  const config = normalizeAiCostConfig({ ...DEFAULT_AI_COST_CONFIG, prices: { "claude-sonnet-5": { input: 2, output: 10 } }, defaultPrice: { input: 4, output: 20 }, imagePriceUsd: 0.05 });
  // 1 juta input ($2) + 200 ribu output ($2) = $4 = Rp4.000
  assert.equal(rupiahFor([{ model: "claude-sonnet-5", kind: "chat", input: 1_000_000, output: 200_000, calls: 10 }], config), 4000);
  // model tak dikenal pakai harga bawaan; 2 gambar x $0.05 = Rp100
  assert.equal(rupiahFor([{ model: "lain", kind: "chat", input: 1_000_000, output: 0, calls: 1 }, { model: "img", kind: "image", input: 0, output: 0, calls: 2 }], config), 4100);
  assert.equal(estimateCallRupiah({ model: "claude-sonnet-5", kind: "chat", inputTokens: 20_000, outputTokens: 8000 }, config), 120);
});

test("batas harian/mingguan/bulanan: periode pertama yang terlampaui dilaporkan", () => {
  const limits = { day: 10_000, week: null, month: 50_000 };
  assert.equal(exceededPeriod({ day: 9_000, week: 30_000, month: 40_000 }, limits, 500), null);
  assert.equal(exceededPeriod({ day: 9_800, week: 30_000, month: 40_000 }, limits, 500), "day");
  assert.equal(exceededPeriod({ day: 100, week: 30_000, month: 49_900 }, limits, 500), "month");
  assert.equal(exceededPeriod({ day: 1e9, week: 1e9, month: 1e9 }, { day: null, week: null, month: null }, 1), null);
});

test("awal periode dihitung WIB: hari, Senin, tanggal 1", () => {
  // Rabu 2026-11-11 17:18 WIB = 10:18 UTC
  const starts = periodStarts(new Date("2026-11-11T10:18:00Z"));
  assert.equal(starts.day.toISOString(), "2026-11-10T17:00:00.000Z");
  assert.equal(starts.week.toISOString(), "2026-11-08T17:00:00.000Z"); // Senin 9 Nov 00:00 WIB
  assert.equal(starts.month.toISOString(), "2026-10-31T17:00:00.000Z");
  // Minggu 2026-11-15 23:30 WIB masih minggu yang sama
  assert.equal(periodStarts(new Date("2026-11-15T16:30:00Z")).week.toISOString(), "2026-11-08T17:00:00.000Z");
  // Senin 00:30 WIB sudah minggu baru
  assert.equal(periodStarts(new Date("2026-11-15T17:30:00Z")).week.toISOString(), "2026-11-15T17:00:00.000Z");
});

test("pesan batas jelas untuk pengguna dan tidak diganti pesan teknis", () => {
  for (const scope of ["user", "global"] as const) {
    for (const period of ["day", "week", "month"] as const) {
      const message = costLimitMessage(scope, period);
      assert.equal(getErrorMessage(new Error(message)), message);
    }
  }
  assert.match(costLimitMessage("user", "week"), /minggu ini.*minggu depan/);
});

test("transport AI memeriksa batas rupiah sebelum memesan kuota dan memanggil provider", async () => {
  const client = await readFile(new URL("../src/lib/ai/client.ts", import.meta.url), "utf8");
  assert.match(client, /await assertAiCostAllowed\(context\.ownerId, charge\);\s*await reserveAiBudget\(context, charge\);/);
  const route = await readFile(new URL("../src/app/api/admin/ai-cost/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireSuperAdmin\(\)/g);
  assert.equal(route.match(/requireSuperAdmin\(\)/g)?.length, 2);
});
