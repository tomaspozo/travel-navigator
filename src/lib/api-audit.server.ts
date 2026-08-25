/**
 * Compliance audit log for server-side API calls.
 *
 * SECURITY: the service role key itself is never stored. We persist a
 * truncated SHA-256 fingerprint instead — stable for a given key (so you can
 * tell which key was used and when it was rotated) but not reversible and
 * useless to anyone who reads the table, a backup, or a log dump.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

let cachedFingerprint: string | null | undefined;

async function serviceKeyFingerprint(): Promise<string | null> {
  if (cachedFingerprint !== undefined) return cachedFingerprint;

  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    cachedFingerprint = null;
    return null;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  cachedFingerprint = `sha256:${hex.slice(0, 16)}`;
  return cachedFingerprint;
}

/**
 * Record an API call. Never throws — auditing must not break the caller.
 * Keep secrets, tokens and raw credentials out of `payload`.
 */
export async function logApiCall(
  endpoint: string,
  payload: unknown = {},
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("api_call_logs").insert({
      endpoint,
      payload: (payload ?? {}) as never,
      key_fingerprint: await serviceKeyFingerprint(),
    });
    if (error) console.error("[api-audit] insert failed", error.message);
  } catch (err) {
    console.error("[api-audit] insert threw", err);
  }
}
