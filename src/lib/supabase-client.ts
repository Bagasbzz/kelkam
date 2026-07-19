import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client - uses the SERVICE_ROLE key.
 * Make sure to set these environment variables in your .env.local:
 *
 * SUPABASE_URL="https://<your-project>.supabase.co"
 * SUPABASE_SERVICE_ROLE_KEY="service_role_xxx"
 *
 * WARNING: The service role key is highly privileged. Do NOT expose it to the browser.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Do NOT throw here to avoid crashing at import time in environments without env set.
  console.warn("Supabase admin keys not set. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable persistence.");
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
  },
});