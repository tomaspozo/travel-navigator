import { createServerFn } from "@tanstack/react-start";
import { supabaseStartMiddleware, userId } from "@/lib/middleware/supabase-start";
import { z } from "zod";

/** Gate only — no service-role client, no email. Those are added per endpoint. */
const authed = supabaseStartMiddleware({ auth: "user", middleware: [] });

const eventSchema = z.object({
  requestId: z.string().uuid(),
  event: z.enum(["submitted", "approved", "rejected", "escalated", "human_review_requested"]),
  reason: z.string().max(2000).optional(),
});

/** Fan-out notifications (in-app + email) for a travel request event. */
export const notifyRequestEvent = createServerFn({ method: "POST" })
  .middleware([authed])
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
    const summary = await notifications.requestSummary(data.requestId);
    if (!summary) throw new Error("Request not found");

    const { req, requester, requesterName, managerId } = summary;
    const trip = `${req.destination} — ${req.start_date} to ${req.end_date} (${notifications.money(Number(req.total_budget))})`;

    switch (data.event) {
      case "submitted": {
        const stage = managerId ? "manager" : "finance";
        const targets = await notifications.reviewerTargets(stage, managerId);
        return notifications.notifyUsers(targets, {
          kind: "request_submitted",
          title: `New travel request to review — ${req.destination}`,
          requestId: req.id,
          body: `${requesterName} submitted a travel request that passed validation and is waiting for your review.\n\n${trip}\n\nPurpose: ${req.purpose}`,
        });
      }
      case "escalated": {
        const targets = await notifications.reviewerTargets("finance", null);
        return notifications.notifyUsers(targets, {
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
        return notifications.notifyUsers([requester], {
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
        const targets = await notifications.adminTargets();
        return notifications.notifyUsers(targets, {
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
