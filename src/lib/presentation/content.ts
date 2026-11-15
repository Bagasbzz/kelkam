/** Aturan isi slide bersama renderer desain. */

/** Em dash/en dash are a hallmark of AI text; slides never show them. */
export function noDash(value: string) {
  return value
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/^\s*[–—]+\s*/g, "")
    .replace(/\s*[–—]+\s*/g, ", ");
}

/** Body convention: "Label: isi" gives card headers, numbers for stats, and info rows. */
export function splitLabel(value: string): { label: string; text: string } {
  const match = /^([^:.!?]{1,42}):\s+([\s\S]+)$/u.exec(value.trim());
  return match ? { label: noDash(match[1].trim()), text: noDash(match[2].trim()) } : { label: "", text: noDash(value.trim()) };
}
