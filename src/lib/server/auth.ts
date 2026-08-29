import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

export interface AuthenticatedRequest {
  token: string;
  user: User;
  supabase: SupabaseClient;
}

export type AuthenticationResult =
  | { ok: true; auth: AuthenticatedRequest }
  | { ok: false; response: NextResponse };

function configurationError() {
  return NextResponse.json(
    { success: false, error: "Konfigurasi autentikasi server belum lengkap." },
    { status: 503 },
  );
}

function createPublicServerClient(accessToken?: string) {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) return null;

  return createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
  });
}

export function createAnonymousServerSupabase(): SupabaseClient {
  const client = createPublicServerClient();
  if (!client) throw new Error("SUPABASE_SERVER_CONFIG_MISSING");
  return client;
}

export function createUserScopedSupabase(accessToken: string): SupabaseClient {
  const client = createPublicServerClient(accessToken);
  if (!client) {
    throw new Error("SUPABASE_SERVER_CONFIG_MISSING");
  }
  return client;
}

export async function authenticateRequest(req: Request): Promise<AuthenticationResult> {
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
    console.error("Supabase URL/publishable key is missing on the server.");
    return { ok: false, response: configurationError() };
  }

  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  const token = match?.[1] || "";

  if (!token || token.length > 4096) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Silakan masuk terlebih dahulu untuk melanjutkan." },
        { status: 401 },
      ),
    };
  }

  const authClient = createPublicServerClient();
  if (!authClient) return { ok: false, response: configurationError() };

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Sesi sudah tidak valid. Silakan masuk kembali." },
        { status: 401 },
      ),
    };
  }

  return {
    ok: true,
    auth: {
      token,
      user: data.user,
      supabase: createUserScopedSupabase(token),
    },
  };
}

export function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(value);
}

export async function ownsProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("project_id, owner_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) {
    console.error("Project ownership lookup failed:", error.code || "unknown");
    return { ok: false as const, reason: "lookup_failed" as const };
  }

  if (!data || String(data.owner_id) !== String(userId)) {
    return { ok: false as const, reason: "not_found" as const };
  }

  return { ok: true as const, project: data };
}

export async function ensureOwnedProject(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
) {
  const ownership = await ownsProject(supabase, userId, projectId);
  if (ownership.ok || ownership.reason === "lookup_failed") return ownership;

  const { data, error } = await supabase
    .from("projects")
    .insert({ project_id: projectId, owner_id: userId })
    .select("project_id, owner_id")
    .maybeSingle();

  if (error) {
    const reason = error.code === "23505" ? "already_owned" : "create_failed";
    console.error("Project creation failed:", error.code || "unknown");
    return { ok: false as const, reason };
  }

  return { ok: true as const, project: data };
}
