import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily job: remind reviewers/admins about travel requests still waiting.
 * Called by the scheduler with the cron bearer secret.
 */
export const Route = createFileRoute("/api/public/cron/pending-reviews")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = /^Bearer ([^\s,]+)$/.exec(
          request.headers.get("authorization") ?? "",
        )?.[1];
        if (!token) return new Response("Unauthorized", { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: ok } = await supabaseAdmin.rpc("verify_cron_token", {
          _token: token,
        });
        if (ok !== true) return new Response("Unauthorized", { status: 401 });
        const notifications = await import("@/lib/notifications.server");

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

          const summary = await notifications.requestSummary(row.id as string);
          if (!summary) continue;

          const stage = row.status === "pending_manager" ? "manager" : "finance";
          const targets = await notifications.reviewerTargets(
            stage as "manager" | "finance",
            stage === "manager" ? summary.managerId : null,
          );
          const admins = await notifications.adminTargets();
          const all = [...targets, ...admins].filter(
            (t, i, arr) => arr.findIndex((x) => x.userId === t.userId) === i,
          );

          await notifications.notifyUsers(all, {
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

        const { logApiCall } = await import("@/lib/api-audit.server");
        await logApiCall("cron/pending-reviews", {
          pending: pending?.length ?? 0,
          reminded,
        });

        return Response.json({ ok: true, pending: pending?.length ?? 0, reminded });
      },
    },
  },
});
