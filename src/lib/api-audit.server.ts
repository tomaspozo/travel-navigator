/**
 * Compliance audit log for server-side API calls.
 *
 * SECURITY: the service role key itself is never stored — not in full and not
 * as a prefix. We persist the first 5 hex characters of its SHA-256 digest:
 * short, stable for a given key (so you can see which key was used and when it
 * was rotated), not reversible, and worthless if the table, a backup or a log
 * is exposed.
 *
 * Note: a raw 5-character key prefix would be useless here anyway — every
 * Supabase key opens with the same fixed marker (`sb_se`, or `eyJhb` for legacy
 * JWT keys), so it would be identical on every row and unchanged by rotation.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Characters of the digest kept in `api_call_logs.key_fingerprint`. */
const FINGERPRINT_LENGTH = 5;

let cachedFingerprint: string | null | undefined;
let cachedFormat: "modern" | "legacy" | null | undefined;

async function loadKeyInfo(): Promise<void> {
  if (cachedFingerprint !== undefined) return;

  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    cachedFingerprint = null;
    cachedFormat = null;
    return;
  }

  cachedFormat = key.startsWith("sb_se") ? "modern" : "legacy";

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  cachedFingerprint = hex.slice(0, FINGERPRINT_LENGTH);
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
    await loadKeyInfo();
    const basePayload =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : { value: payload };
    const { error } = await supabaseAdmin.from("api_call_logs").insert({
      endpoint,
      payload: { ...basePayload, key_format: cachedFormat ?? "unknown" } as never,
      key_fingerprint: cachedFingerprint ?? null,
    });

    if (error) console.error("[api-audit] insert failed", error.message);
  } catch (err) {
    console.error("[api-audit] insert threw", err);
  }
}
