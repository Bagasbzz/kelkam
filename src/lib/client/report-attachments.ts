import { MAX_FILE_BYTES } from "../file-limits";

export const MAX_CHAT_ATTACHMENTS = 10;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function clipboardFiles(clipboard: Pick<DataTransfer, "items">): File[] {
  return Array.from(clipboard.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function attachmentError(file: File, admin = false): string | null {
  const image = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|svg|bmp|heic)$/i.test(file.name);
  if (image && !IMAGE_TYPES.has(file.type)) return "Gunakan gambar PNG, JPG, WebP, atau GIF.";
  const limit = image ? 8 * 1024 * 1024 : admin ? 50 * 1024 * 1024 : MAX_FILE_BYTES;
  if (!file.size) return "Berkas kosong tidak dapat dilampirkan.";
  if (file.size > limit) return `Ukuran ${image ? "gambar" : "berkas"} maksimal ${Math.round(limit / 1048576)} MB.`;
  return null;
}
