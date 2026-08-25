import { createServerFn } from "@tanstack/react-start";
import { supabaseStartMiddleware, userId } from "@/lib/middleware/supabase-start";
import { withLovableEmail } from "@/lib/lovable-middleware/with-lovable-email";
import { renderEmailHtml } from "./email.server";
import { z } from "zod";

/** Gate only. Reads through RLS; no service-role, no email. */
const authed = supabaseStartMiddleware({ auth: "user", middleware: [] });

/**
 * Fanning out notifications writes rows for *other* users, so this endpoint
 * needs service-role and outbound email.
 *
 * Note it does NOT list withSupabaseAdminClient. Adding it would be a no-op:
 * withSupabase always folds both client entries itself, so ctx.supabaseAdmin is
 * present on every endpoint using it, asked for or not. Opting out only becomes
 * possible after SDK-1614, when the gate is a standalone entry and the
 * composition is [withAuth('user'), withSupabaseClient()] with no admin client
 * at all.
 */
const authedWithNotify = supabaseStartMiddleware({
  auth: "user",
  middleware: [withLovableEmail({ render: renderEmailHtml })],
});

const eventSchema = z.object({
  requestId: z.string().uuid(),
  event: z.enum(["submitted", "approved", "rejected", "escalated", "human_review_requested"]),
  reason: z.string().max(2000).optional(),
});

/** Fan-out notifications (in-app + email) for a travel request event. */
export const notifyRequestEvent = createServerFn({ method: "POST" })
  .middleware([authedWithNotify])
  .inputValidator((data: unknown) => eventSchema.parse(data))
  .handler(async ({ data, context }) => {
    // The caller must be able to see the request under RLS.
    const { data: visible } = await context.supabase
      .from("travel_requests")
      .select("id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!visible) throw new Error("Request not found");

    const notifications = await import("./notifications.server");
    const summary = await notifications.requestSummary(context, data.requestId);
    if (!summary) throw new Error("Request not found");

    const { req, requester, requesterName, managerId } = summary;
    const trip = `${req.destination} — ${req.start_date} to ${req.end_date} (${notifications.money(Number(req.total_budget))})`;

    switch (data.event) {
      case "submitted": {
        const stage = managerId ? "manager" : "finance";
        const targets = await notifications.reviewerTargets(context, stage, managerId);
        return notifications.notifyUsers(context, targets, {
          kind: "request_submitted",
          title: `New travel request to review — ${req.destination}`,
          requestId: req.id,
          body: `${requesterName} submitted a travel request that passed validation and is waiting for your review.\n\n${trip}\n\nPurpose: ${req.purpose}`,
        });
      }
      case "escalated": {
        const targets = await notifications.reviewerTargets(context, "finance", null);
        return notifications.notifyUsers(context, targets, {
          kind: "request_escalated",
          title: `Travel request needs finance sign-off — ${req.destination}`,
          requestId: req.id,
          body: `${requesterName}'s trip was approved by their manager and now needs finance/executive review.\n\n${trip}`,
        });
      }
      case "approved":
      case "rejected": {
        if (!requester) return { notified: 0, emailed: 0 };
        const approved = data.event === "approved";
        return notifications.notifyUsers(context, [requester], {
          kind: approved ? "request_approved" : "request_rejected",
          title: `Your travel request was ${approved ? "approved" : "rejected"} — ${req.destination}`,
          requestId: req.id,
          body: `${trip}\n\n${
            data.reason
              ? `Reviewer comment: ${data.reason}`
              : approved
                ? "You're good to go."
                : "No comment was left."
          }`,
        });
      }
      case "human_review_requested": {
        const targets = await notifications.adminTargets(context);
        return notifications.notifyUsers(context, targets, {
          kind: "human_review_requested",
          title: `Human review requested — ${req.destination}`,
          requestId: req.id,
          body: `${requesterName} disagrees with the AI validation and asked for a human review.\n\n${trip}\n\nReason: ${data.reason ?? "—"}`,
        });
      }
    }
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authed])
  .handler(async ({ context }) => {
    await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null)
      .eq("user_id", userId(context));
    return { ok: true };
  });
