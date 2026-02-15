import { createClient } from "@supabase/supabase-js";

function normalizeSupabaseUrl(rawUrl: string) {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("SUPABASE_URL is empty");

  try {
    const parsed = new URL(trimmed);

    // Common misconfiguration: dashboard URL instead of API project URL.
    if (parsed.hostname === "supabase.com" && parsed.pathname.startsWith("/dashboard/project/")) {
      const segments = parsed.pathname.split("/").filter(Boolean);
      const projectRef = segments[2];
      if (projectRef) {
        return `https://${projectRef}.supabase.co`;
      }
    }

    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    throw new Error("Invalid SUPABASE_URL value");
  }
}

const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseUrl = rawSupabaseUrl ? normalizeSupabaseUrl(rawSupabaseUrl) : null;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in environment variables");
}

if (!supabaseServiceRoleKey) {
  throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in environment variables");
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
