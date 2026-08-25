import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import type { LovableEmail } from "@/lib/lovable-middleware/with-lovable-email";

/**
 * What this module needs, passed in rather than reached for.
 *
 * Previously every function here did its own
 * `await import("@/integrations/supabase/client.server")`, which made
 * service-role ambient: any server module could obtain it by typing an import.
 * Taking it as an argument makes the dependency visible at each call site, and
 * an endpoint that never composes withSupabaseAdminClient simply cannot reach
 * this code.
 */
export interface NotifyDeps {
  supabaseAdmin: SupabaseClient<Database>;
  email: LovableEmail;
}

type AdminOnly = Pick<NotifyDeps, "supabaseAdmin">;

export type NotificationKind =
  | "request_submitted"
  | "request_approved"
  | "request_rejected"
  | "request_escalated"
  | "human_review_requested"
  | "pending_review_reminder";

export interface NotifyTarget {
  userId: string;
  email: string;
}

export interface NotifyPayload {
  kind: NotificationKind;
  title: string;
  body: string;
  requestId?: string | null;
}

function appUrl(requestId?: string | null) {
  const base = process.env["APP_BASE_URL"] ?? "";
  if (!base || !requestId) return undefined;
  return `${base.replace(/\/$/, "")}/requests/${requestId}`;
}

/** Creates in-app notifications and sends the matching emails. */
export async function notifyUsers(
  deps: NotifyDeps,
  targets: NotifyTarget[],
  payload: NotifyPayload,
) {
  if (targets.length === 0) return { notified: 0, emailed: 0 };

  const { supabaseAdmin, email } = deps;

  let emailed = 0;
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (const target of targets) {
    let sent = false;
    if (target.email) {
      sent = await email.send({
        to: target.email,
        subject: payload.title,
        heading: payload.title,
        body: payload.body,
        actionUrl: appUrl(payload.requestId),
      });
    }
    if (sent) emailed += 1;
    rows.push({
      user_id: target.userId,
      request_id: payload.requestId ?? null,
      kind: payload.kind,
      title: payload.title,
      body: payload.body,
      emailed_at: sent ? now : null,
    });
  }

  const { error } = await supabaseAdmin.from("notifications").insert(rows as never);
  if (error) console.error("[notify] insert failed", error);

  return { notified: rows.length, emailed };
}

async function profilesFor(deps: AdminOnly, userIds: string[]): Promise<NotifyTarget[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { supabaseAdmin } = deps;
  const { data } = await supabaseAdmin.from("profiles").select("id, email").in("id", ids);
  return (data ?? []).map((p) => ({ userId: p.id as string, email: (p.email as string) ?? "" }));
}

/** Everyone who can act as a reviewer for the given stage. */
export async function reviewerTargets(
  deps: AdminOnly,
  stage: "manager" | "finance",
  managerId?: string | null,
): Promise<NotifyTarget[]> {
  if (stage === "manager" && managerId) return profilesFor(deps, [managerId]);
  const { supabaseAdmin } = deps;
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["finance", "admin"]);
  return profilesFor(
    deps,
    (data ?? []).map((r) => r.user_id as string),
  );
}

export async function adminTargets(deps: AdminOnly): Promise<NotifyTarget[]> {
  const { supabaseAdmin } = deps;
  const { data } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
  return profilesFor(
    deps,
    (data ?? []).map((r) => r.user_id as string),
  );
}

export async function requestSummary(deps: AdminOnly, requestId: string) {
  const { supabaseAdmin } = deps;
  const { data } = await supabaseAdmin
    .from("travel_requests")
    .select(
      "id, requester_id, destination, purpose, start_date, end_date, total_budget, status, human_review_requested, human_review_reason",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return null;
  const [requester] = await profilesFor(deps, [data.requester_id as string]);
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, manager_id")
    .eq("id", data.requester_id as string)
    .maybeSingle();
  return {
    req: data as unknown as {
      id: string;
      requester_id: string;
      destination: string;
      purpose: string;
      start_date: string;
      end_date: string;
      total_budget: number;
      status: string;
    },
    requester: requester ?? null,
    requesterName: (profile?.full_name as string) || requester?.email || "A team member",
    managerId: (profile?.manager_id as string | null) ?? null,
  };
}

export function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}
