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

export interface TugasSummary {
  id: string;
  courseId: string;
  classId: string | null;
  class: { id: string; name: string } | null;
  title: string;
  description: string;
  deadline: string;
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
  user?: { id: string; email: string; name: string | null };
}

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

  const resp = await authenticatedFetch(path, {
    ...rest,
    body,
    headers: json !== undefined ? { ...headers, "Content-Type": "application/json" } : headers,
  });

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
    `/api/tugas/courses/by-token?${qs}`
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

export function submitTugas(
  tugasId: string,
  input: {
    classId: string;
    nim: string;
    name: string;
    note?: string;
    fileUploadId?: string;
  },
) {
  return request<{ submission: SubmissionRow; position: number; total: number }>(
    `/api/tugas/tugas/${tugasId}/submit`,
    { method: "POST", json: input }
  );
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
  const resp = await authenticatedFetch("/api/files/upload", {
    method: "POST",
    body: form,
  });
  const json = (await resp.json().catch(() => ({ success: false }))) as {
    success?: boolean;
    error?: string;
    data?: { fileId: string; sha256: string; size: number; mime: string };
  };
  if (!resp.ok || !json?.success || !json.data) {
    throw new ApiClientError(resp.status, json?.error || "Upload gagal.");
  }
  return json.data;
}