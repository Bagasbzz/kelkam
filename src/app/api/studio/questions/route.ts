import { NextResponse } from "next/server";
import { sendToAIForPurpose } from "@/lib/ai/client";
import { authenticateRequest } from "@/lib/server/auth";
import {
  enforceRateLimit,
  publicErrorResponse,
  readJsonBody,
} from "@/lib/server/request-guards";
import type { QuestionCategory, QuestionClass } from "@/lib/studio/engine";

export const maxDuration = 60;

const categories = new Set<QuestionCategory>([
  "identity",
  "scope",
  "actors",
  "requirements",
  "flow",
  "exceptions",
  "data",
  "method",
  "format",
  "citation",
  "lecturer",
  "conflict",
]);
const classes = new Set<QuestionClass>(["blocker", "important", "enrichment"]);
const artifactIds = new Set([
  "project-spec",
  "requirements",
  "actor-matrix",
  "usecase-main",
  "activity-main",
  "sequence-main",
  "test-cases",
  "outline",
  "report-draft",
  "format-profile",
  "final-docx",
]);

function clamp(value: unknown, max: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max);
}

function parseJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value.match(/\{[\s\S]*\}/)?.[0] || value;
  return JSON.parse(candidate) as { questions?: unknown[]; findings?: unknown[] };
}

export async function POST(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;

  const rateLimit = enforceRateLimit(`studio-question-scan:${authentication.auth.user.id}`, {
    limit: 6,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req, 140_000);
    const intake = body.intake && typeof body.intake === "object" ? body.intake : {};
    const specification =
      body.specification && typeof body.specification === "object" ? body.specification : {};
    const unresolvedQuestions = Array.isArray(body.unresolvedQuestions)
      ? body.unresolvedQuestions.slice(0, 30)
      : [];
    const sources = Array.isArray(body.sources)
      ? body.sources.slice(0, 16).map((sourceValue) => {
          const source = sourceValue && typeof sourceValue === "object"
            ? (sourceValue as Record<string, unknown>)
            : {};
          return {
            id: clamp(source.id, 100),
            kind: clamp(source.kind, 40),
            authority: clamp(source.authority, 30),
            title: clamp(source.title, 240),
            content: clamp(source.content, 5_000),
          };
        })
      : [];

    const prompt = [
      "Audit konteks proyek akademik berikut seperti requirements engineer, reviewer dosen, editor akademik, dan QA UML.",
      "Tujuan Anda BUKAN menulis laporan. Temukan hanya pertanyaan bernilai tinggi yang belum dijawab oleh konteks, konflik antar-sumber, asumsi berbahaya, exception yang hilang, dan aturan format yang belum eksplisit.",
      "Jangan ulangi pertanyaan unresolved yang sudah tersedia kecuali ada konflik spesifik baru.",
      "Urutkan blocker terlebih dahulu. Maksimal 10 pertanyaan.",
      "Balas hanya JSON object dengan schema:",
      '{"questions":[{"prompt":"...","why":"...","answerHint":"...","category":"scope|actors|requirements|flow|exceptions|data|method|format|citation|lecturer|conflict|identity","class":"blocker|important|enrichment","sourceIds":["source-id"],"affectedArtifactIds":["project-spec"]}],"findings":["ringkasan temuan"]}',
      "sourceIds hanya boleh memakai ID sumber yang diberikan.",
      "affectedArtifactIds hanya boleh memakai: project-spec, requirements, actor-matrix, usecase-main, activity-main, sequence-main, test-cases, outline, report-draft, format-profile, final-docx.",
      "Gunakan Bahasa Indonesia yang konkret, satu isu per pertanyaan, dan jangan menebak fakta.",
      `Intake: ${JSON.stringify(intake)}`,
      `Specification saat ini: ${JSON.stringify(specification)}`,
      `Pertanyaan belum selesai: ${JSON.stringify(unresolvedQuestions)}`,
      `Sumber: ${JSON.stringify(sources)}`,
    ].join("\n\n");

    const response = await sendToAIForPurpose(
      prompt,
      "Anda adalah auditor requirements akademik yang konservatif. Prioritaskan pencegahan revisi dan konsistensi lintas artefak. Keluarkan JSON valid saja.",
      "review",
    );
    const parsed = parseJsonObject(response);
    const validSourceIds = new Set(sources.map((source) => source.id).filter(Boolean));

    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .slice(0, 10)
      .map((questionValue) => {
        const question = questionValue && typeof questionValue === "object"
          ? (questionValue as Record<string, unknown>)
          : {};
        const categoryValue = clamp(question.category, 30) as QuestionCategory;
        const classValue = clamp(question.class, 30) as QuestionClass;
        return {
          prompt: clamp(question.prompt, 500),
          why: clamp(question.why, 700),
          answerHint: clamp(question.answerHint, 600),
          category: categories.has(categoryValue) ? categoryValue : "conflict",
          class: classes.has(classValue) ? classValue : "important",
          sourceIds: Array.isArray(question.sourceIds)
            ? question.sourceIds
                .map((id) => clamp(id, 100))
                .filter((id) => validSourceIds.has(id))
            : [],
          affectedArtifactIds: Array.isArray(question.affectedArtifactIds)
            ? question.affectedArtifactIds
                .map((id) => clamp(id, 80))
                .filter((id) => artifactIds.has(id))
            : [],
        };
      })
      .filter((question) => question.prompt.length >= 12);

    const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
      .slice(0, 8)
      .map((finding) => clamp(finding, 500))
      .filter(Boolean);

    return NextResponse.json(
      { success: true, data: { questions, findings } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/studio/questions failed:", error);
    return publicErrorResponse(error, "Deep Scan gagal. Pertanyaan deterministik tetap dapat dipakai.");
  }
}
