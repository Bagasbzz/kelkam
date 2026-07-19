"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * Browser (public) Supabase client.
 * Requires these env variables in .env.local (or Vercel env):
 * NEXT_PUBLIC_SUPABASE_URL
 * NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * This client is safe for use in the browser (no service role).
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Magic-link auth will not work without these."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // keep session in memory only for dev; browser persistence handled by supabase client
    persistSession: true,
    detectSessionInUrl: true,
  },
});