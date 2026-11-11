/**
 * scripts/dev-seed.ts
 * -----------------------------------------------------------------------------
 * Data contoh untuk database LOKAL (uji tampilan/responsif). Menolak berjalan bila DATABASE_URL bukan localhost.
 * Idempoten: menghapus lalu membuat ulang data milik akun-akun contoh di bawah.
 *
 * Akun (sandi semua: devpass123):
 *   hensellbagas@gmail.com  → super admin (role ADMIN + email pemilik)
 *   dosen@contoh.test       → admin Tugas / pengajar
 *   mahasiswa@contoh.test   → pengguna biasa (punya laporan, presentasi, tugas)
 *   user01..user24@contoh.test → pengguna tambahan untuk daftar/analitik
 *
 * Jalankan: npx tsx scripts/dev-seed.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import argon2 from "argon2";
import { createStarterDeck } from "../src/lib/presentation/model";

const url = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error("[dev-seed] DATABASE_URL harus mengarah ke localhost. Dibatalkan.");
  process.exit(1);
}

const prisma = new PrismaClient();
const DAY = 86_400_000;
const PASSWORD = "devpass123";
const daysAgo = (n: number, hour = 10) => new Date(Date.now() - n * DAY - (Date.now() % DAY) + hour * 3_600_000 - 7 * 3_600_000);
const pick = <T,>(list: T[], i: number) => list[i % list.length];

const EMAILS = ["hensellbagas@gmail.com", "dosen@contoh.test", "mahasiswa@contoh.test", ...Array.from({ length: 24 }, (_, i) => `user${String(i + 1).padStart(2, "0")}@contoh.test`)];

function source(i: number, extra: Partial<Record<string, unknown>> = {}) {
  const titles = [
    "Budaya Konsumtif di Media Sosial TikTok: Pendekatan Kritis terhadap Pengaruh Kapitalisme pada Generasi Muda di Indonesia",
    "Pengaruh Konten Hiburan Televisi terhadap Pola Komunikasi Keluarga di Wilayah Perkotaan",
    "Literasi Media Digital pada Remaja: Studi Kasus Sekolah Menengah di Jawa Barat",
    "Television Viewing Habits and Family Communication Patterns: A Longitudinal Study",
    "Analisis Framing Acara Gimmick pada Program Hiburan Stasiun Televisi Swasta Nasional",
    "Media Consumption and Parasocial Interaction among Indonesian University Students",
    "Peran Orang Tua dalam Mendampingi Anak Menonton Televisi di Era Digital",
    "Uses and Gratifications Theory Revisited: Entertainment Content in the Streaming Era",
  ];
  const authors = [["Graha Wira Krida", "Alexander Seran"], ["Siti Rahmawati"], ["Budi Santoso", "Rina Wulandari", "Ahmad Fauzi"], ["John Miller", "Sarah Chen"]];
  return {
    id: `src-${i + 1}`,
    title: pick(titles, i),
    authors: pick(authors, i),
    year: 2019 + (i % 6),
    venue: pick(["Jurnal Global Ilmiah", "Jurnal Komunikasi Indonesia", "Journal of Media Studies", "Jurnal Ilmu Sosial"], i),
    abstract: "Penelitian ini membahas pengaruh konten hiburan terhadap perilaku komunikasi dengan pendekatan kuantitatif. Hasil menunjukkan hubungan yang signifikan antara intensitas menonton dan pola interaksi dalam keluarga. ".repeat(2),
    url: `https://doi.org/10.55324/jgi.v2i5.${180 + i}`,
    pdfUrl: i % 2 ? null : `https://example.org/pdf/${i}.pdf`,
    doi: `10.55324/jgi.v2i5.${180 + i}`,
    doiUrl: `https://doi.org/10.55324/jgi.v2i5.${180 + i}`,
    doiVerified: true,
    pdfStatus: i % 2 ? "none" : "verified",
    citationCount: 3 * i,
    isOpenAccess: i % 2 === 0,
    issn: ["3026-5207"],
    inDoaj: i % 3 === 0,
    venueType: "journal",
    language: i % 4 === 3 ? "en" : "id",
    sourceProviders: ["crossref", "openalex"],
    citationApa: `${pick(authors, i)[0]} (${2019 + (i % 6)}). ${pick(titles, i)}.`,
    qualitySignals: ["DOI terverifikasi Crossref", "Diterbitkan di jurnal"],
    checkLinks: [{ label: "Cek SINTA", url: "https://sinta.kemdikbud.go.id" }],
    readLevel: i % 2 ? "abstract" : "fulltext",
    relevance: 90 - i * 3,
    selected: i < 10,
    kind: i === 7 ? "book" : "journal",
    ...extra,
  };
}

const LONG_MESSAGE = `Bener banget, dan justru lebih santai. Saat ini kita sudah pegang **47 jurnal terverifikasi terseleksi**, artinya sudah di bawah batas 50 dan nggak perlu dipaksa nambah sampai 50.

Jadi status kita sekarang:

- ✅ Topik & metode kepenuhan sudah lengkap
- ✅ 47 sumber jurnal terseleksi (dominan teks penuh)
- ✅ Matriks penelitian terdahulu + research gap + kebaruan
- ✅ Kerangka 5 bab + 2 diagram + 3 tabel + 2 ilustrasi

Tinggal satu langkah: aku mulai nulis draftnya ya.

Ketik **"eksekusi"** atau **"lanjut"** untuk mulai.`;

const DRAFT = `# Pengaruh Konten Hiburan Televisi terhadap Pola Komunikasi Keluarga

## BAB I PENDAHULUAN

### 1.1 Latar Belakang

Perkembangan media hiburan televisi di Indonesia membawa perubahan pada cara keluarga berkomunikasi (Krida & Seran, 2023). Program hiburan dengan format *gimmick* semakin banyak ditayangkan pada jam utama.

### 1.2 Rumusan Masalah

1. Bagaimana intensitas menonton konten hiburan pada keluarga perkotaan?
2. Seberapa besar pengaruhnya terhadap pola komunikasi keluarga?

## BAB II TINJAUAN PUSTAKA

### 2.1 Teori Uses and Gratifications

Teori ini menjelaskan bahwa audiens aktif memilih media untuk memenuhi kebutuhannya (Miller & Chen, 2021).

**Tabel: Matriks Penelitian Terdahulu**

| No | Peneliti (Tahun) | Judul | Metode | Hasil |
|---|---|---|---|---|
| 1 | Krida & Seran (2023) | Budaya Konsumtif di Media Sosial TikTok | Kualitatif | Konsumsi dipengaruhi tren |
| 2 | Rahmawati (2020) | Pengaruh Konten Hiburan Televisi | Survei | Hubungan signifikan |

## BAB III METODE PENELITIAN

Penelitian ini menggunakan pendekatan kuantitatif dengan kuesioner kepada 120 responden keluarga.

## Daftar Pustaka

Krida, G. W., & Seran, A. (2023). Budaya konsumtif di media sosial TikTok. *Jurnal Global Ilmiah*, 2(5). https://doi.org/10.55324/jgi.v2i5.186
`;

async function main() {
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  // Bersihkan data contoh lama (cascade untuk relasi), lalu tabel analitik milik akun contoh.
  const old = await prisma.user.findMany({ where: { email: { in: EMAILS } }, select: { id: true } });
  const oldIds = old.map((u) => u.id);
  if (oldIds.length) {
    await prisma.reportMessage.deleteMany({ where: { session: { ownerId: { in: oldIds } } } });
    await prisma.reportSession.deleteMany({ where: { ownerId: { in: oldIds } } });
    for (const model of ["activityEvent", "loginEvent", "aiUsage", "feedback"] as const) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma[model] as any).deleteMany({ where: model === "aiUsage" ? { ownerId: { in: oldIds } } : { userId: { in: oldIds } } });
    }
    await prisma.userPresence.deleteMany({ where: { userId: { in: oldIds } } });
    await prisma.user.deleteMany({ where: { id: { in: oldIds } } });
  }
  await prisma.activityEvent.deleteMany({ where: { visitorId: { startsWith: "dev-guest-" } } });

  const users = [] as { id: string; email: string }[];
  for (const [i, email] of EMAILS.entries()) {
    const role = i < 2 ? "ADMIN" : "USER";
    const name = i === 0 ? "Bagas (Pemilik)" : i === 1 ? "Dr. Dosen Contoh, M.Kom." : i === 2 ? "Mahasiswa Contoh Dengan Nama Cukup Panjang" : `Pengguna ${i - 2}`;
    users.push(await prisma.user.create({ data: { email, name, role, passwordHash: hash, createdAt: daysAgo(i < 3 ? 40 : 29 - (i % 29)) }, select: { id: true, email: true } }));
  }
  const [owner, dosen, mhs, ...others] = users;

  // ---------------- Laporan ----------------
  const sources = Array.from({ length: 14 }, (_, i) => source(i));
  const plan = {
    outline: ["Pendahuluan", "Tinjauan Pustaka", "Metode Penelitian", "Hasil dan Pembahasan", "Penutup"].map((title, i) => ({
      id: `section-${i + 1}`, title, purpose: `Tujuan bab ${title.toLowerCase()} untuk menjawab rumusan masalah penelitian.`,
      subsections: ["Latar Belakang", "Rumusan Masalah", "Tujuan Penelitian"].map((s) => `${s} ${i + 1}`), targetPages: [8, 12, 8, 14, 4][i], requiredDiagrams: i === 2 ? ["d1"] : [],
    })),
    diagrams: [{ id: "d1", title: "Alur Penelitian", type: "flowchart", purpose: "Tahapan penelitian", sectionId: "section-3", status: "planned" }],
    tables: [{ id: "t1", title: "Definisi Operasional Variabel", purpose: "Variabel dan indikator", columns: ["Variabel", "Definisi", "Indikator", "Skala"], sectionId: "section-3" }],
    figures: [{ id: "f1", title: "Kerangka Pemikiran", caption: "Kerangka pemikiran penelitian", prompt: "conceptual framework illustration", sectionId: "section-2" }],
    sourceQueries: ["pengaruh konten hiburan televisi komunikasi keluarga", "television entertainment family communication"],
    researchMatrix: {
      rows: sources.slice(0, 5).map((s) => ({ sourceId: s.id, peneliti: `${s.authors[0].split(" ").at(-1)} (${s.year})`, judul: s.title, tujuan: "Mengukur pengaruh konten hiburan", metode: "Survei kuantitatif", hasil: "Pengaruh signifikan dan positif", keterbatasan: "Sampel terbatas di satu kota", perbedaan: "Penelitian ini fokus pada keluarga perkotaan" })),
      gap: "Belum ada penelitian yang mengukur konten gimmick secara khusus pada keluarga perkotaan.",
      novelty: "Mengukur pengaruh konten gimmick terhadap pola komunikasi keluarga dengan instrumen baru.",
    },
  };
  const brief = { documentType: "skripsi", title: "Pengaruh Konten Hiburan Televisi terhadap Pola Komunikasi Keluarga", topic: "konten hiburan televisi", course: "Ilmu Komunikasi", institution: "Universitas Contoh", citationStyle: "APA 7", journalRequirement: "bebas", maxSources: 50, language: "id", targetLength: "60-80 halaman" };
  const s1 = await prisma.reportSession.create({ data: { ownerId: mhs.id, title: "Pengaruh Konten Hiburan Televisi terhadap Pola Komunikasi Keluarga", stage: "planned", brief, plan, sources: sources as unknown as Prisma.InputJsonValue, materials: [] } });
  const conversation = [
    ["user", "Saya mau bikin skripsi tentang pengaruh konten hiburan televisi terhadap pola komunikasi keluarga."],
    ["assistant", "Siap. Boleh saya tahu jenis dokumen, syarat jurnal dari dosen, dan gaya sitasinya?\n\n1. Jenis dokumen?\n2. Syarat jurnal (SINTA/Scopus/bebas)?\n3. Ada target minimal jumlah sumber?"],
    ["user", "ekonomi.boleh research gap, 50 aja maksimal nya"],
    ["assistant", "Rencana sudah saya susun. **Kerangka 5 bab**:\n\n1. Pendahuluan (8 halaman)\n2. Tinjauan Pustaka (12 hlm)\n3. Metode Penelitian (8 hlm)\n4. Hasil dan Pembahasan (14 hlm)\n5. Penutup (4 hlm)\n\nKalau sudah oke, ketik **\"eksekusi\"**."],
    ["user", "kan maksimal 50,bukan minimal, kalo kurang dikit ya gpp"],
    ["assistant", LONG_MESSAGE],
  ] as const;
  for (const [i, [role, content]] of conversation.entries()) {
    await prisma.reportMessage.create({ data: { sessionId: s1.id, role, content, createdAt: new Date(Date.now() - (conversation.length - i) * 60_000), ...(role === "assistant" ? { toolCalls: { tools: ["findSources", "selectSources", "setResearchMatrix", "proposePlan"] } } : {}) } });
  }
  const s2 = await prisma.reportSession.create({ data: { ownerId: mhs.id, title: "Integration of Waterfall and Agile Methods in Campus Information Systems", stage: "drafted", brief: { ...brief, title: "Integration of Waterfall and Agile Methods" }, plan, sources: sources.slice(0, 8) as unknown as Prisma.InputJsonValue, materials: [], draft: DRAFT } });
  await prisma.reportMessage.create({ data: { sessionId: s2.id, role: "assistant", content: "Draft laporan sudah selesai ditulis. Silakan periksa di tab **Draft**, lalu minta revisi per bagian bila perlu." } });
  for (const [i, title] of ["Pengaruh acara gimmick (televisi) terhadap minat menonton remaja", "Pengaruh peristiwa (acara/event) kampus", "Web development (pengembangan sistem informasi akademik)", "Pendahuluan Etika Profesi Teknologi Informasi", "Sistem informasi yang saya buat untuk tugas akhir", null, null].entries()) {
    const s = await prisma.reportSession.create({ data: { ownerId: mhs.id, title, stage: pick(["planned", "drafted", "intake"], i), brief: title ? { title } : {}, updatedAt: daysAgo(i + 1) } });
    await prisma.reportMessage.create({ data: { sessionId: s.id, role: "user", content: title ? `Tolong bantu ${title.toLowerCase()}` : "halo" } });
  }

  // ---------------- Presentasi ----------------
  for (const [i, theme] of (["editorial", "product", "playful"] as const).entries()) {
    const deck = createStarterDeck(theme);
    const envelope = { kind: "presentation", schemaVersion: 1, revision: 3, updatedAt: daysAgo(i).toISOString(), deck, history: [] };
    await prisma.project.create({ data: { projectId: deck.id, ownerId: mhs.id, metadata: envelope as unknown as Prisma.InputJsonValue } });
  }

  // ---------------- Tugas ----------------
  await prisma.course.deleteMany({ where: { token: { in: ["kelas-demo", "kelas-demo-2"] } } });
  const course = await prisma.course.create({ data: { name: "Pemrograman Web Lanjut", code: "IF-301", description: "Mata kuliah praktikum pengembangan aplikasi web modern dengan Next.js dan basis data.", token: "kelas-demo", createdById: dosen.id } });
  await prisma.course.create({ data: { name: "Basis Data", code: "IF-205", token: "kelas-demo-2", createdById: dosen.id } });
  await prisma.courseAdmin.create({ data: { courseId: course.id, userId: dosen.id } });
  const classA = await prisma.courseClass.create({ data: { courseId: course.id, name: "IF-3A" } });
  const classB = await prisma.courseClass.create({ data: { courseId: course.id, name: "IF-3B" } });
  for (let i = 0; i < 24; i++) {
    await prisma.mahasiswa.create({ data: { courseId: course.id, classId: i % 2 ? classB.id : classA.id, nim: `2210${String(1000 + i)}`, name: i === 0 ? "Mahasiswa Contoh Dengan Nama Cukup Panjang" : `Mahasiswa ${i + 1}` } });
  }
  const tugasList = [
    { title: "Tugas 1: Membuat Halaman Login Responsif", deadline: daysAgo(-5), pertemuan: 3 },
    { title: "Tugas 2: CRUD dengan Prisma dan PostgreSQL (dikumpulkan dalam bentuk ZIP beserta laporan singkat)", deadline: daysAgo(-12), pertemuan: 4 },
    { title: "Tugas 0: Instalasi Lingkungan", deadline: daysAgo(3), pertemuan: 1 },
  ];
  for (const [ti, t] of tugasList.entries()) {
    const tugas = await prisma.tugas.create({ data: { courseId: course.id, title: t.title, description: "Kerjakan sesuai instruksi di pertemuan.\n\n- Gunakan Tailwind CSS\n- Pastikan tampilan rapi di HP\n- Kumpulkan sebelum batas waktu", deadline: t.deadline, pertemuan: t.pertemuan, createdById: dosen.id } });
    const submitters = ti === 2 ? [mhs, ...others.slice(0, 15)] : ti === 0 ? others.slice(0, 6) : [];
    for (const [si, u] of submitters.entries()) {
      await prisma.tugasSubmission.create({ data: { tugasId: tugas.id, userId: u.id, classId: si % 2 ? classB.id : classA.id, nim: `2210${String(1000 + si)}`, name: si === 0 && u.id === mhs.id ? "Mahasiswa Contoh Dengan Nama Cukup Panjang" : `Mahasiswa ${si + 1}`, note: si % 3 ? null : "Link repo: https://github.com/contoh/tugas", position: si + 1, status: si === 4 ? "LATE" : "SUBMITTED", submittedAt: daysAgo(4 + (si % 3)), nilai: si % 2 ? 85 : null } });
    }
  }
  await prisma.courseEnrollment.create({ data: { courseId: course.id, userId: mhs.id } });

  // ---------------- Analitik ----------------
  const features = ["/", "/dashboard", "/presentasi", "/tugas", "/uml-builder", "/fitur", "/studio"];
  const featureOf: Record<string, string> = { "/": "beranda", "/dashboard": "laporan", "/presentasi": "presentasi", "/tugas": "tugas", "/uml-builder": "diagram", "/fitur": "halaman-fitur", "/studio": "studio" };
  const events: Prisma.ActivityEventCreateManyInput[] = [];
  const usage: Prisma.AiUsageCreateManyInput[] = [];
  const logins: Prisma.LoginEventCreateManyInput[] = [];
  const active = [mhs, owner, ...others];
  for (let d = 0; d < 30; d++) {
    for (let g = 0; g < 5 + (d % 7); g++) events.push({ visitorId: `dev-guest-${d}-${g}`, kind: "page", path: pick(features, g), feature: featureOf[pick(features, g)], createdAt: daysAgo(d, 8 + (g % 12)) });
    const today = active.filter((_, i) => (i + d) % 3 === 0 || i < 2);
    for (const [ui, u] of today.entries()) {
      for (let k = 0; k < 3; k++) events.push({ visitorId: `dev-${u.id}`, userId: u.id, kind: "page", path: pick(features, ui + k), feature: featureOf[pick(features, ui + k)], createdAt: daysAgo(d, 9 + k) });
      if ((ui + d) % 4 === 0) logins.push({ userId: u.id, method: "password", createdAt: daysAgo(d, 8) });
      const calls = u.id === mhs.id ? 12 : 1 + (ui % 4);
      for (let c = 0; c < calls; c++) usage.push({ ownerId: u.id, operation: pick(["agent:laporan", "report-chapter", "agent:presentasi", "image-job"], c), model: c % 5 === 4 ? "deepseek-v4-pro" : c % 7 === 6 ? "gpt-image-2" : "claude-sonnet-5", kind: c % 7 === 6 ? "image" : "chat", inputTokens: 12_000 + c * 900, outputTokens: 2_500 + c * 300, actual: c % 3 !== 0, ok: c % 11 !== 10, createdAt: daysAgo(d, 10 + (c % 10)) });
    }
  }
  await prisma.activityEvent.createMany({ data: events });
  await prisma.aiUsage.createMany({ data: usage });
  await prisma.loginEvent.createMany({ data: logins });
  for (const [i, u] of active.entries()) await prisma.userPresence.create({ data: { userId: u.id, lastSeenAt: new Date(Date.now() - (i < 3 ? 60_000 : i * 3_600_000)) } });
  await prisma.feedback.createMany({ data: [
    { userId: mhs.id, feature: "laporan", targetId: "m1", rating: 1 },
    { userId: others[0].id, feature: "laporan", targetId: "m2", rating: -1, comment: "Sumbernya kurang sesuai dengan topik saya, dan tombol eksekusi tidak jalan." },
    { userId: others[1].id, feature: "presentasi", targetId: "m3", rating: 1 },
  ] });
  await prisma.adminAuditLog.create({ data: { actorId: owner.id, action: "set-ai-cost", detail: "contoh log audit" } });
  await prisma.appSetting.upsert({
    where: { key: "ai_cost" },
    create: { key: "ai_cost", value: { enabled: true, usdToIdr: 1000, global: { day: 20000, week: null, month: 300000 }, perUser: { day: 5000, week: null, month: 50000 }, prices: { "claude-sonnet-5": { input: 2, output: 10 }, "deepseek-v4-pro": { input: 0.5, output: 2 } }, defaultPrice: { input: 2, output: 10 }, imagePriceUsd: 0.05 } },
    update: {},
  });

  console.log(`[dev-seed] selesai: ${users.length} akun, ${events.length} kunjungan, ${usage.length} panggilan AI. Sandi semua akun: ${PASSWORD}`);
  console.log(`[dev-seed] course: /tugas/kelas-demo · laporan contoh milik mahasiswa@contoh.test`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => void prisma.$disconnect());
