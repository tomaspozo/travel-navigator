import type { LovableAI } from "@/lib/lovable-middleware/with-lovable-ai";
import type { AiReview, AiReviewCheck, AiReviewInput } from "./ai-review-types";

/** Raised for a gateway failure so the caller can surface the message as-is. */
export class AiReviewUnavailable extends Error {}

const CHECK_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["pass", "warn", "fail"] },
    summary: { type: "string" },
    suggestion: { type: "string" },
  },
  required: ["status", "summary", "suggestion"],
  additionalProperties: false,
} as const;

function fallbackCheck(summary: string): AiReviewCheck {
  return { status: "warn", summary, suggestion: "Try running the review again." };
}

export async function reviewTravelRequest(ai: LovableAI, input: AiReviewInput): Promise<AiReview> {
  const nights = input.hotel_nights;
  const prompt = `You are the travel-policy reviewer for a company travel approval tool.

REQUEST
Destination: ${input.destination}
Dates: ${input.start_date} to ${input.end_date} (${input.trip_days} days)
Purpose / description written by the requester:
"""${input.purpose}"""
Transportation: ${input.transportation_type}, ${input.currency} ${input.transportation_cost}
Hotel: ${input.currency} ${input.hotel_nightly_rate} per night x ${nights} nights
Per diem requested: ${input.currency} ${input.per_diem_rate} per day
Other costs: ${input.currency} ${input.other_costs}
Total estimated budget: ${input.currency} ${input.total_budget}

COMPANY POLICY FOR THIS REQUESTER (role: ${input.role})
Approved trip / event types: ${input.event_types.length ? input.event_types.join("; ") : "(none configured)"}
Max trip days: ${input.max_trip_days}
Max ticket price: ${input.currency} ${input.max_ticket_price}
Max hotel per night: ${input.currency} ${input.max_hotel_per_night}
Max per diem per day: ${input.currency} ${input.per_diem}

Run exactly three checks and be strict but fair:

1. description_quality — Is the purpose/description good enough? It MUST state (a) why the travel is needed, (b) what will concretely happen there, and (c) the expected business outcome or who is being met. Vague text like "business trip" or "client visit" fails. Under 15 meaningful words is a fail.
2. event_type_fit — Does the described trip clearly match one of the approved trip/event types above? Name the matched type in the summary. If it only loosely matches, warn. If it matches none, fail.
3. budget_realism — Are the costs realistic for the destination country/city and trip length, using typical market rates there (flights/train from a normal corporate origin, business-standard hotels, local meal costs)? Flag anything clearly above typical market rates, and also flag suspiciously low figures that will not cover the trip. Mention concrete typical ranges for that destination in the summary.

Keep every summary under 320 characters, plain language, addressed to the requester.`;

  // The gateway URL, the API key, and what 402/429 mean are the middleware's
  // business now. This module owns the prompt, the tool schema, and parsing.
  const result = await ai.toolCall({
    prompt,
    tool: {
      name: "submit_review",
      description: "Return the three validation results.",
      parameters: {
        type: "object",
        properties: {
          description_quality: CHECK_SCHEMA,
          event_type_fit: CHECK_SCHEMA,
          budget_realism: CHECK_SCHEMA,
        },
        required: ["description_quality", "event_type_fit", "budget_realism"],
        additionalProperties: false,
      },
    },
  });

  if (!result.ok) throw new AiReviewUnavailable(result.message);
  const raw = result.arguments;

  let parsed: Partial<Record<keyof AiReview, AiReviewCheck>> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    parsed = {};
  }

  const pick = (key: "description_quality" | "event_type_fit" | "budget_realism") => {
    const c = parsed[key];
    if (!c || !["pass", "warn", "fail"].includes(c.status)) {
      return fallbackCheck("The reviewer did not return a result for this check.");
    }
    return {
      status: c.status,
      summary: String(c.summary ?? "").slice(0, 600),
      suggestion: String(c.suggestion ?? "").slice(0, 600),
    } satisfies AiReviewCheck;
  };

  return {
    description_quality: pick("description_quality"),
    event_type_fit: pick("event_type_fit"),
    budget_realism: pick("budget_realism"),
    reviewed_at: new Date().toISOString(),
  };
}
