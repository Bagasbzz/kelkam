import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_MATERIALS_DIR = path.join(process.cwd(), "uploads", "course-materials");

export interface CourseMaterialFile {
  id: string;
  originalName: string;
  mime: string;
  size: number;
  uploadedAt: string;
}

function materialsRoot(): string {
  return process.env.MATERIALS_DIR || DEFAULT_MATERIALS_DIR;
}

function courseDirectory(courseId: string): string {
  return path.join(materialsRoot(), courseId);
}

function validateMaterialId(materialId: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(materialId)) throw new Error("Material tidak valid.");
}

function metadataPath(courseId: string, materialId: string): string {
  validateMaterialId(materialId);
  return path.join(courseDirectory(courseId), `${materialId}.json`);
}

function filePath(courseId: string, materialId: string, extension: string): string {
  validateMaterialId(materialId);
  return path.join(courseDirectory(courseId), `${materialId}${extension}`);
}

export async function listCourseMaterials(courseId: string): Promise<CourseMaterialFile[]> {
  const directory = courseDirectory(courseId);
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const materials = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map(async (entry) => {
    try {
      const material = JSON.parse(await fs.readFile(path.join(directory, entry), "utf8")) as CourseMaterialFile;
      await fs.access(filePath(courseId, material.id, path.extname(material.originalName).toLowerCase()));
      return material;
    } catch {
      return null;
    }
  }));

  return materials
    .filter((material): material is CourseMaterialFile => material !== null)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function saveCourseMaterial(input: {
  courseId: string;
  buffer: Buffer;
  originalName: string;
  mime: string;
}): Promise<CourseMaterialFile> {
  const extension = path.extname(input.originalName).toLowerCase();
  const id = randomUUID();
  const material: CourseMaterialFile = {
    id,
    originalName: input.originalName,
    mime: input.mime,
    size: input.buffer.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  const directory = courseDirectory(input.courseId);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath(input.courseId, id, extension), input.buffer);
  await fs.writeFile(metadataPath(input.courseId, id), JSON.stringify(material), "utf8");
  return material;
}

export async function readCourseMaterial(courseId: string, materialId: string): Promise<{
  material: CourseMaterialFile;
  buffer: Buffer;
} | null> {
  try {
    const material = JSON.parse(await fs.readFile(metadataPath(courseId, materialId), "utf8")) as CourseMaterialFile;
    const buffer = await fs.readFile(filePath(courseId, material.id, path.extname(material.originalName).toLowerCase()));
    return { material, buffer };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteCourseMaterial(courseId: string, materialId: string): Promise<boolean> {
  const material = await readCourseMaterial(courseId, materialId);
  if (!material) return false;
  await Promise.all([
    fs.unlink(filePath(courseId, material.material.id, path.extname(material.material.originalName).toLowerCase())),
    fs.unlink(metadataPath(courseId, material.material.id)),
  ]);
  return true;
}
