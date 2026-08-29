"use client";

import { supabase } from "@/lib/supabase-browser";

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Silakan masuk terlebih dahulu untuk memakai fitur ini.");
    this.name = "AuthenticationRequiredError";
  }
}

export async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new AuthenticationRequiredError();
  return data.session.access_token;
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, { ...init, headers });
}
