interface FailureContext {
  runId: string;
  kind: string;
  phase: "step" | "final";
  step: number;
  elapsedMs: number;
  toolCount: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9_\[\].:-]{1,120}$/.test(value)) return undefined;
  if (/^(?:sk-|bearer|https?:|[A-Za-z]:\\)/i.test(value)) return undefined;
  return value;
}

/** Deliberately excludes provider messages, prompts, bodies, headers and credentials. */
export function providerFailureDiagnostic(error: unknown, context: FailureContext) {
  const outer = record(error);
  const details = record(outer.error);
  const status = Number(outer.status);
  return {
    event: "agent_provider_failure",
    runId: identifier(context.runId),
    kind: identifier(context.kind),
    phase: context.phase,
    step: Number.isSafeInteger(context.step) ? context.step : undefined,
    elapsedMs: Number.isFinite(context.elapsedMs) ? Math.max(0, Math.round(context.elapsedMs)) : undefined,
    toolCount: Number.isSafeInteger(context.toolCount) ? context.toolCount : undefined,
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
    name: identifier(outer.name),
    code: identifier(outer.code ?? details.code),
    type: identifier(outer.type ?? details.type),
    param: identifier(outer.param ?? details.param),
    requestId: identifier(outer.request_id ?? outer.requestID),
    causeName: identifier(record(outer.cause).name),
  };
}
