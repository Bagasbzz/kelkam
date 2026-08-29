const SECRET_LINE = /(^|\n)(\s*[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|SERVICE[_-]?ROLE)[A-Z0-9_]*\s*[=:]\s*)([^\r\n]+)/gi;
const JSON_SECRET = /("(?:api[_-]?key|secret|token|password|private[_-]?key|service[_-]?role)"\s*:\s*")([^"]+)(")/gi;
const KNOWN_TOKEN = /\b(?:sb_secret_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,})\b/g;
const PRIVATE_KEY = /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/g;

const SENSITIVE_FILE_NAMES = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_ed25519)(?:\.|$)/i,
  /(^|\/).*\.(?:pem|p12|pfx|key)$/i,
  /(^|\/)(?:credentials|secrets?)(?:\.|\/|$)/i,
  /(^|\/)\.npmrc$/i,
];

export function isSensitivePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return SENSITIVE_FILE_NAMES.some((pattern) => pattern.test(normalized));
}

export function redactSensitiveText(value: string) {
  return value
    .replace(PRIVATE_KEY, "[PRIVATE KEY DIHAPUS]")
    .replace(SECRET_LINE, (_match, prefix, label) => `${prefix}${label}[RAHASIA DIHAPUS]`)
    .replace(JSON_SECRET, (_match, start, _secret, end) => `${start}[RAHASIA DIHAPUS]${end}`)
    .replace(KNOWN_TOKEN, "[TOKEN DIHAPUS]");
}

export function sanitizeForPersistence<T>(value: T, depth = 0): T {
  if (depth > 12) return null as T;
  if (typeof value === "string") return redactSensitiveText(value) as T;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPersistence(item, depth + 1)) as T;
  }
  if (value && typeof value === "object") {
    const sanitized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        if (/api[_-]?key|secret|token|password|private[_-]?key|service[_-]?role/i.test(key)) {
          return [key, "[RAHASIA DIHAPUS]"];
        }
        return [key, sanitizeForPersistence(item, depth + 1)];
      }),
    );
    return sanitized as T;
  }
  return value;
}
