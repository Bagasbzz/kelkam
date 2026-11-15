/** Utilitas warna bersama renderer desain (kontras dihitung sendiri, warna dari AI tidak dipercaya mentah). */

const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const channel = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

export function mix(a: string, b: string, amount: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return x.map((value, i) => Math.round((value + (y[i] - value) * amount) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Warna teks yang terbaca di atas `fill`: `preferred` bila kontras cukup, selain itu putih atau hampir hitam. */
export const readableOn = (fill: string, preferred: string) => contrast(preferred, fill) >= 4.5 ? preferred : contrast("FFFFFF", fill) >= contrast("151515", fill) ? "FFFFFF" : "151515";
