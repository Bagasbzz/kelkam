export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    && error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

export function isAbortLikeError(error: unknown) {
  return /timeout|timed out|aborted|deadline/i.test(getErrorMessage(error, ""));
}
