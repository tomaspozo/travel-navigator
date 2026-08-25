import { createServerFn } from "@tanstack/react-start";
import { supabaseStartMiddleware, userId as currentUserId } from "@/lib/middleware/supabase-start";
import { withLovableAI } from "@/lib/lovable-middleware/with-lovable-ai";
import { z } from "zod";
import type { AiReview } from "./ai-review-types";

/**
 * Reads through RLS and calls the Lovable AI gateway. Deliberately no
 * withSupabaseAdminClient — this endpoint has no business holding service-role.
 */
const authed = supabaseStartMiddleware({
  auth: "user",
  middleware: [withLovableAI()],
});

const inputSchema = z.object({
  destination: z.string().min(1),
  purpose: z.string().default(""),
  start_date: z.string(),
  end_date: z.string(),
  trip_days: z.number(),
  transportation_type: z.string(),
  transportation_cost: z.number(),
  hotel_nightly_rate: z.number(),
  hotel_nights: z.number(),
  per_diem_rate: z.number(),
  other_costs: z.number(),
  total_budget: z.number(),
});

export const runAiReview = createServerFn({ method: "POST" })
  .middleware([authed])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AiReview> => {
    const { supabase } = context;
    const userId = currentUserId(context);

    const [{ data: roleRows }, { data: policies }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("travel_policies").select("*"),
    ]);

    const roles = (roleRows ?? []).map((r) => r.role as string);
    const order = ["admin", "finance", "manager", "employee"];
    const role = order.find((r) => roles.includes(r)) ?? "employee";
    const policy = (policies ?? []).find((p) => (p as { role: string }).role === role) as
      | {
          event_types?: string[] | null;
          max_trip_days: number;
          max_ticket_price: number;
          max_hotel_per_night: number;
          per_diem: number;
        }
      | undefined;

    const { reviewTravelRequest } = await import("./ai-review.server");

    return reviewTravelRequest(context.lovableAI, {
      ...data,
      currency: "USD",
      role,
      event_types: policy?.event_types ?? [],
      max_trip_days: policy?.max_trip_days ?? 0,
      max_ticket_price: policy?.max_ticket_price ?? 0,
      max_hotel_per_night: policy?.max_hotel_per_night ?? 0,
      per_diem: policy?.per_diem ?? 0,
    });
  });
