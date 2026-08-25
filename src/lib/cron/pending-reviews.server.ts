import { withSupabase } from "@supabase/server";

import { withLovableEmail } from "@/lib/lovable-middleware/with-lovable-email";
import { renderEmailHtml } from "@/lib/email.server";
import type { Database } from "@/integrations/supabase/types";

/**
 * Daily job: remind reviewers and admins about travel requests still waiting.
 *
 * Auth is `secret:cron` — a named secret key, so the scheduler's credential
 * rotates without touching anything else. That replaces three things at once:
 * the hand-rolled `Bearer` regex, the `verify_cron_token` RPC (a database round
 * trip on every run, purely to compare a shared secret), and the generated
 * `cron-auth.ts` that solved the same problem and was never imported.
 *
 * The scheduler must send the key in the `apikey` header. `secret` modes never
 * read `Authorization`, so a caller still sending `Authorization: Bearer …`
 * gets a bare 401 with no hint — worth knowing when updating the cron job.
 *
 * `secret:cron` also points `ctx.supabaseAdmin` at `secretKeys['cron']` rather
 * than `default`, so that entry has to hold a real Supabase secret key.
 */
// Hoisted so its tuple type can be passed explicitly below. Supplying only
// `<Database>` would leave `Entries` on its default `readonly AnyEntry[]` —
// TypeScript has no partial type-argument inference — and every contribution
// from this array would erase, taking `ctx.email` with it.
const cronMiddleware = [withLovableEmail({ render: renderEmailHtml })] as const;

export const handlePendingReviews = withSupabase<Database, typeof cronMiddleware>(
  {
    auth: "secret:cron",
    cors: "disabled",
    middleware: cronMiddleware,
  },
  async (_req, ctx) => {
    const notifications = await import("@/lib/notifications.server");
    const { supabaseAdmin } = ctx;

    const { data: pending, error } = await supabaseAdmin
      .from("travel_requests")
      .select("id, status, last_reminded_at")
      .in("status", ["pending_manager", "pending_finance"]);

    if (error) return new Response(error.message, { status: 500 });

    const cutoff = Date.now() - 20 * 60 * 60 * 1000; // at most one reminder a day
    let reminded = 0;

    for (const row of pending ?? []) {
      const last = row.last_reminded_at ? new Date(row.last_reminded_at).getTime() : 0;
      if (last > cutoff) continue;

      const summary = await notifications.requestSummary(ctx, row.id as string);
      if (!summary) continue;

      const stage = row.status === "pending_manager" ? "manager" : "finance";
      const targets = await notifications.reviewerTargets(
        ctx,
        stage as "manager" | "finance",
        stage === "manager" ? summary.managerId : null,
      );
      const admins = await notifications.adminTargets(ctx);
      const all = [...targets, ...admins].filter(
        (t, i, arr) => arr.findIndex((x) => x.userId === t.userId) === i,
      );

      await notifications.notifyUsers(ctx, all, {
        kind: "pending_review_reminder",
        title: `Still waiting for review — ${summary.req.destination}`,
        requestId: summary.req.id,
        body: `${summary.requesterName}'s travel request has been waiting for ${stage} review.\n\n${summary.req.destination} — ${summary.req.start_date} to ${summary.req.end_date} (${notifications.money(Number(summary.req.total_budget))})`,
      });

      await supabaseAdmin
        .from("travel_requests")
        .update({ last_reminded_at: new Date().toISOString() })
        .eq("id", row.id as string);
      reminded += 1;
    }

    return Response.json({ ok: true, pending: pending?.length ?? 0, reminded });
  },
);
