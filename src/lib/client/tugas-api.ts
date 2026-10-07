/**
 * src/lib/client/tugas-api.ts
 * -----------------------------------------------------------------------------
 * Typed wrapper di atas `authenticatedFetch()` untuk API Tugas.
 *
 * Semua response punya shape `{ success: boolean, error?: string, ...data }`.
 * Helper di file ini auto-parse JSON, auto-throw `ApiClientError` kalau
 * `success: false` (supaya caller tinggal `try { await ... } catch { ... }`).
 *
 * Pemakaian:
 *   import { listTugas, submitTugas } from "@/lib/client/tugas-api";
 *   const { tugases } = await listTugas({ courseId: "..." });
 *   await submitTugas(tugasId, { classId, nim, name, note, fileUploadId });
 * -----------------------------------------------------------------------------
 */

import { authenticatedFetch } from "@/components/AuthProvider";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly apiError: string,
  ) {
    super(apiError);
    this.name = "ApiClientError";
  }
}

const REQUEST_TIMEOUT_MS = 45_000;
const UPLOAD_TIMEOUT_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await authenticatedFetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    const message = isAbortError(error)
      ? "Koneksi ke server terlalu lama. Coba lagi."
      : "Koneksi ke server terputus. Periksa internet lalu coba lagi.";
    throw new ApiClientError(0, message);
  } finally {
    clearTimeout(timeout);
  }
}
// ---------------------------------------------------------------------------
// Shared types (mirror Prisma shape — boleh ringkas)
// ---------------------------------------------------------------------------

export interface CourseSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  token: string;
  createdAt: string;
  updatedAt: string;
  classes: { id: string; name: string }[];
}

export interface CourseMaterial {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

export interface TugasSummary {
  id: string;
  courseId: string;
  classId: string | null;
  class: { id: string; name: string } | null;
  title: string;
  description: string;
  deadline: string;
  /** Nomor pertemuan (opsional). */
  pertemuan?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmissionRow {
  id: string;
  tugasId: string;
  classId: string;
  class: { id: string; name: string };
  nim: string;
  name: string;
  note: string | null;
  fileUpload: {
    id: string;
    originalName: string;
    mime: string;
    size: number;
  } | null;
  position: number;
  status: "SUBMITTED" | "LATE" | "REJECTED";
  submittedAt: string;
  /** Terisi hanya kalau mahasiswa pernah mengubah pengumpulannya. */
  updatedAt: string | null;
  /** Catatan dari admin course; null kalau belum ada. */
  feedback: string | null;
  feedbackAt: string | null;
  /** Nilai angka 0-100 dari admin; null kalau belum dinilai. */
  nilai?: number | null;
  nilaiHuruf?: string | null;
  nilaiAt?: string | null;
  user?: { id: string; email: string; name: string | null };
}

export type SubmissionInput = {
  classId: string;
  nim: string;
  name: string;
  note?: string;
  fileUploadId?: string;
};

export interface ManagedCourse {
  id: string;
  name: string;
  code: string;
  token: string;
  description: string | null;
  createdAt: string;
  isCreator: boolean;
}

// ---------------------------------------------------------------------------
// Generic fetcher
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers: Record<string, string> = {
    ...((rest.headers as Record<string, string>) || {}),
  };
  const body = json !== undefined ? JSON.stringify(json) : rest.body;

  const resp = await fetchWithTimeout(
    path,
    {
      ...rest,
      body,
      headers: json !== undefined ? { ...headers, "Content-Type": "application/json" } : headers,
    },
    REQUEST_TIMEOUT_MS,
  );

  const payload = (await resp.json().catch(() => ({ success: false }))) as {
    success?: boolean;
    error?: string;
  } & T;

  if (!resp.ok || payload?.success === false) {
    throw new ApiClientError(resp.status, payload?.error || `HTTP ${resp.status}`);
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

/** Ambil info user + daftar course yang di-manage. */
export function fetchMe() {
  return request<{ isAdmin: boolean; managedCourses: ManagedCourse[] }>("/api/tugas/me");
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/** Lookup course publik by token (mahasiswa). */
export function fetchCourseByToken(token: string) {
  const qs = new URLSearchParams({ token }).toString();
  return request<{ course: CourseSummary; tugases: TugasSummary[] }>(
    `/api/tugas/courses/by-token?${qs}`,
    { cache: "no-store" },
  );
}

/** Buat course baru (admin global). */
export function createCourse(input: {
  name: string;
  code: string;
  description?: string;
  classes: string[];
}) {
  return request<{ course: CourseSummary }>("/api/tugas/courses", {
    method: "POST",
    json: input,
  });
}

/** Tambah class baru ke course (course admin). */
export function addCourseClass(courseId: string, name: string) {
  return request<{ class: { id: string; name: string } }>(
    `/api/tugas/courses/${courseId}/classes`,
    { method: "POST", json: { name } }
  );
}

export function updateCourse(courseId: string, input: { name: string; description: string }) {
  return request<{ course: CourseSummary }>(`/api/tugas/courses/${courseId}`, {
    method: "PATCH", json: input,
  });
}

export function updateCourseClass(courseId: string, classId: string, name: string) {
  return request<{ class: { id: string; name: string } }>(
    `/api/tugas/courses/${courseId}/classes/${classId}`,
    { method: "PATCH", json: { name } },
  );
}

/** Tambah co-admin (course creator only). */
export function addCourseAdmin(courseId: string, email: string) {
  return request<{ admin: { id: string; email: string; name: string | null } }>(
    `/api/tugas/courses/${courseId}/admins`,
    { method: "POST", json: { email } }
  );
}

/** Enroll user ke course (opsional). */
export function enrollCourse(courseId: string) {
  return request<{ enrollmentId: string }>(
    `/api/tugas/courses/${courseId}/enroll`,
    { method: "POST" }
  );
}

// ---------------------------------------------------------------------------
// Tugas CRUD
// ---------------------------------------------------------------------------

export function createTugas(input: {
  courseId: string;
  classId?: string | null;
  title: string;
  description: string;
  deadline: string; // ISO
  pertemuan?: number | null;
}) {
  return request<{ tugas: TugasSummary }>("/api/tugas/tugas", {
    method: "POST",
    json: input,
  });
}

export function updateTugas(
  tugasId: string,
  patch: Partial<{
    title: string;
    description: string;
    deadline: string;
    classId: string | null;
    pertemuan: number | null;
  }>,
) {
  return request<{ tugas: TugasSummary }>(`/api/tugas/tugas/${tugasId}`, {
    method: "PATCH",
    json: patch,
  });
}

export function deleteTugas(tugasId: string) {
  return request<{ success: true }>(`/api/tugas/tugas/${tugasId}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export function submitTugas(tugasId: string, input: SubmissionInput) {
  return request<{ submission: SubmissionRow; position: number; total: number }>(
    `/api/tugas/tugas/${tugasId}/submit`,
    { method: "POST", json: input }
  );
}

/** Ubah pengumpulan sendiri (hanya sebelum deadline; urutan tidak berubah). */
export function updateMySubmission(tugasId: string, input: SubmissionInput) {
  return request<{ submission: SubmissionRow; position: number; total: number }>(
    `/api/tugas/tugas/${tugasId}/submit`,
    { method: "PATCH", json: input }
  );
}

/** Admin: beri / ubah catatan dan/atau nilai untuk satu pengumpulan. */
export function setSubmissionFeedback(
  submissionId: string,
  feedback: string | undefined,
  nilai?: number | null,
) {
  const json: { feedback?: string; nilai?: number | null } = {};
  if (feedback !== undefined) json.feedback = feedback;
  if (nilai !== undefined) json.nilai = nilai;
  return request<{ submission: SubmissionRow }>(
    `/api/tugas/submissions/${submissionId}/feedback`,
    { method: "PUT", json }
  );
}

/** Admin: hapus catatan. */
export function clearSubmissionFeedback(submissionId: string) {
  return request<{ submission: SubmissionRow }>(
    `/api/tugas/submissions/${submissionId}/feedback`,
    { method: "DELETE" }
  );
}

export function deleteSubmission(submissionId: string) {
  return request<{ success: true }>(`/api/tugas/submissions/${submissionId}`, {
    method: "DELETE",
  });
}

export function fetchMySubmission(tugasId: string) {
  return request<{
    submission: SubmissionRow | null;
    count: number;
    myPosition: number | null;
  }>(`/api/tugas/tugas/${tugasId}/my-submission`);
}

export function fetchAdminSubmissions(tugasId: string) {
  return request<{ submissions: SubmissionRow[] }>(
    `/api/tugas/tugas/${tugasId}/submissions`
  );
}

// ---------------------------------------------------------------------------
// Mahasiswa roster
// ---------------------------------------------------------------------------

export interface MahasiswaRow {
  id: string;
  nim: string;
  name: string;
  email: string | null;
  classId: string | null;
  class: { id: string; name: string } | null;
}

export function fetchMahasiswas(courseId: string, search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  return request<{ mahasiswas: MahasiswaRow[] }>(
    `/api/tugas/courses/${courseId}/mahasiswas${qs}`
  );
}

export function bulkImportMahasiswas(
  courseId: string,
  payload: { entries: Array<{ nim: string; name: string; className?: string; email?: string }> } | { rawText: string },
) {
  return request<{
    inserted: number;
    skipped: number;
    duplicateInDb: number;
    totalSubmitted: number;
    aiParsed: boolean;
  }>(`/api/tugas/courses/${courseId}/mahasiswas`, {
    method: "POST",
    json: payload,
  });
}

export function updateMahasiswa(
  courseId: string,
  mahasiswaId: string,
  patch: { nim?: string; name?: string; classId?: string | null; email?: string },
) {
  return request<{ mahasiswa: MahasiswaRow }>(
    `/api/tugas/courses/${courseId}/mahasiswas/${mahasiswaId}`,
    { method: "PATCH", json: patch }
  );
}

export function deleteMahasiswa(courseId: string, mahasiswaId: string) {
  return request<{ success: true }>(
    `/api/tugas/courses/${courseId}/mahasiswas/${mahasiswaId}`,
    { method: "DELETE" }
  );
}

// ---------------------------------------------------------------------------
// Admin AI Assistant (chat tool-calling)
// ---------------------------------------------------------------------------

export interface AssistantTurn {
  sessionId: string;
  reply: string;
  pendingQuestion: { question: string; options?: string[] } | null;
  toolsUsed: string[];
  model: string;
}

export interface AssistantSessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
  _count: { messages: number };
}

export interface AssistantMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export function sendAssistantMessage(
  courseId: string,
  input: { message: string; sessionId?: string | null; answerTo?: string | null; deep?: boolean },
) {
  return request<AssistantTurn>(`/api/tugas/courses/${courseId}/assistant`, {
    method: "POST",
    json: input,
  });
}

export function fetchAssistantSessions(courseId: string) {
  return request<{ sessions: AssistantSessionSummary[] }>(`/api/tugas/courses/${courseId}/assistant`);
}

export function fetchAssistantHistory(courseId: string, sessionId: string) {
  return request<{ session: { id: string; title: string | null }; messages: AssistantMessage[] }>(
    `/api/tugas/courses/${courseId}/assistant?sessionId=${encodeURIComponent(sessionId)}`,
  );
}

export function deleteAssistantSession(courseId: string, sessionId: string) {
  return request<{ success: true }>(
    `/api/tugas/courses/${courseId}/assistant?sessionId=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
  );
}

/** Admin: mahasiswa roster yang belum mengumpulkan tugas ini. */
export function fetchMissingSubmitters(tugasId: string) {
  return request<{
    rosterTotal: number;
    submitted: number;
    missing: Array<{ id: string; nim: string; name: string; email: string | null; class: { id: string; name: string } | null }>;
  }>(`/api/tugas/tugas/${tugasId}/missing`);
}

// ---------------------------------------------------------------------------
// AI Insights
// ---------------------------------------------------------------------------

export function generateCourseInsights(courseId: string) {
  return request<{
    metrics: {
      totalSubmissions: number;
      totalLate: number;
      lateRate: number;
      rosterCount: number;
      perClass: Record<string, number>;
      tugasesCount: number;
    };
    aiInsights: string;
  }>(`/api/tugas/courses/${courseId}/insights`, { method: "POST" });
}

export function generateAdminInsights() {
  return request<{
    courses: Array<{
      id: string;
      token: string;
      name: string;
      code: string;
      tugasesCount: number;
      totalSubmissions: number;
      lateSubmissions: number;
      lateRate: number;
      rosterCount: number;
    }>;
    globalInsight: string;
  }>("/api/tugas/admin/insights", { method: "POST" });
}

// ---------------------------------------------------------------------------
// Me: history submit per course
// ---------------------------------------------------------------------------

export interface MyTugasWithSubmission extends TugasSummary {
  mySubmission?: {
    id: string;
    status: "SUBMITTED" | "LATE" | "REJECTED";
    submittedAt: string;
    position: number;
    updatedAt: string | null;
    feedback: string | null;
    feedbackAt: string | null;
    class: { id: string; name: string };
    fileUpload: { id: string; originalName: string; mime: string; size: number } | null;
  };
}

export function fetchMyCourseHistory(courseId: string) {
  return request<{
    submitted: MyTugasWithSubmission[];
    missed: TugasSummary[];
    pending: TugasSummary[];
    counts: { submitted: number; missed: number; pending: number };
  }>(`/api/tugas/me/submissions?courseId=${encodeURIComponent(courseId)}`);
}

// ---------------------------------------------------------------------------
// File upload (delegasi ke endpoint existing)
// ---------------------------------------------------------------------------

/**
 * Upload file via endpoint existing `POST /api/files/upload`.
 *
 * Return `fileId` siap diteruskan ke `submitTugas()`.
 * Throws `ApiClientError` kalau upload gagal.
 */
export async function uploadSubmissionFile(file: File): Promise<{
  fileId: string;
  sha256: string;
  size: number;
  mime: string;
}> {
  const form = new FormData();
  form.append("file", file);
  let lastError: unknown;

  // Upload boleh diulang karena endpoint melakukan deduplikasi berdasarkan SHA256.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(
        "/api/files/upload",
        { method: "POST", body: form },
        UPLOAD_TIMEOUT_MS,
      );
      const json = (await resp.json().catch(() => ({ success: false }))) as {
        success?: boolean;
        error?: string;
        data?: { fileId: string; sha256: string; size: number; mime: string };
      };
      if (!resp.ok || !json?.success || !json.data) {
        throw new ApiClientError(resp.status, json?.error || "Upload gagal.");
      }
      return json.data;
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiClientError) || error.status !== 0 || attempt === 1) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new ApiClientError(0, "Upload gagal.");
}

export function fetchCourseMaterials(courseId: string, token: string) {
  return request<{ materials: CourseMaterial[] }>(
    `/api/tugas/courses/${courseId}/materials?token=${encodeURIComponent(token)}`,
    { cache: "no-store" },
  );
}

export async function uploadCourseMaterial(courseId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const resp = await authenticatedFetch(`/api/tugas/courses/${courseId}/materials`, {
    method: "POST",
    body: form,
  });
  const payload = (await resp.json().catch(() => ({ success: false }))) as {
    success?: boolean;
    error?: string;
    material?: CourseMaterial;
  };
  if (!resp.ok || !payload.success || !payload.material) {
    throw new ApiClientError(resp.status, payload.error || "Upload materi gagal.");
  }
  return payload.material;
}

export function deleteCourseMaterial(courseId: string, materialId: string) {
  return request<{ success: true }>(
    `/api/tugas/courses/${courseId}/materials/${materialId}`,
    { method: "DELETE" },
  );
}