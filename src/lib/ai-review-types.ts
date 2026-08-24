export type AiCheckStatus = "pass" | "warn" | "fail";

export interface AiReviewCheck {
  status: AiCheckStatus;
  summary: string;
  suggestion: string;
}

export interface AiReview {
  description_quality: AiReviewCheck;
  event_type_fit: AiReviewCheck;
  budget_realism: AiReviewCheck;
  reviewed_at: string;
}

export interface AiReviewInput {
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  trip_days: number;
  transportation_type: string;
  transportation_cost: number;
  hotel_nightly_rate: number;
  hotel_nights: number;
  per_diem_rate: number;
  other_costs: number;
  total_budget: number;
  currency: string;
  role: string;
  event_types: string[];
  max_trip_days: number;
  max_ticket_price: number;
  max_hotel_per_night: number;
  per_diem: number;
}

export const AI_CHECK_LABELS: Record<
  "description_quality" | "event_type_fit" | "budget_realism",
  string
> = {
  description_quality: "Description quality",
  event_type_fit: "Trip type fits policy",
  budget_realism: "Budget vs. destination",
};

export const AI_CHECK_KEYS = [
  "description_quality",
  "event_type_fit",
  "budget_realism",
] as const;

export function reviewHasFailures(review: AiReview | null | undefined): boolean {
  if (!review) return false;
  return AI_CHECK_KEYS.some((k) => review[k].status === "fail");
}
