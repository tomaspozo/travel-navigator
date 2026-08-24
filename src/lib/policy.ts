export type AppRole = "employee" | "manager" | "finance" | "admin";

export type RequestStatus =
  | "draft"
  | "pending_manager"
  | "pending_finance"
  | "approved"
  | "rejected"
  | "cancelled";

export interface TravelPolicy {
  id: string;
  role: AppRole;
  max_trip_days: number;
  max_ticket_price: number;
  max_hotel_per_night: number;
  per_diem: number;
  finance_review_threshold: number;
}

export interface TripDraft {
  start_date: string;
  end_date: string;
  transportation_cost: number;
  hotel_nightly_rate: number;
  hotel_nights: number;
  per_diem_rate: number;
  other_costs: number;
}

export interface PolicyViolation {
  code: string;
  label: string;
  detail: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  employee: "Employee",
  manager: "Manager",
  finance: "Finance / Executive",
  admin: "Admin",
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: "Draft",
  pending_manager: "Awaiting manager",
  pending_finance: "Awaiting finance",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export function tripDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function totalBudget(t: TripDraft): number {
  const days = tripDays(t.start_date, t.end_date);
  return (
    Number(t.transportation_cost || 0) +
    Number(t.hotel_nightly_rate || 0) * Number(t.hotel_nights || 0) +
    Number(t.per_diem_rate || 0) * days +
    Number(t.other_costs || 0)
  );
}

export function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function evaluatePolicy(
  trip: TripDraft,
  policy: TravelPolicy | null,
): PolicyViolation[] {
  if (!policy) return [];
  const out: PolicyViolation[] = [];
  const days = tripDays(trip.start_date, trip.end_date);

  if (days > policy.max_trip_days) {
    out.push({
      code: "trip_length",
      label: "Trip too long",
      detail: `${days} days requested, policy allows ${policy.max_trip_days}.`,
    });
  }
  if (Number(trip.transportation_cost) > policy.max_ticket_price) {
    out.push({
      code: "ticket_price",
      label: "Ticket over limit",
      detail: `${money(Number(trip.transportation_cost))} requested, limit is ${money(policy.max_ticket_price)}.`,
    });
  }
  if (Number(trip.hotel_nightly_rate) > policy.max_hotel_per_night) {
    out.push({
      code: "hotel_rate",
      label: "Hotel over nightly limit",
      detail: `${money(Number(trip.hotel_nightly_rate))} per night, limit is ${money(policy.max_hotel_per_night)}.`,
    });
  }
  if (Number(trip.per_diem_rate) > policy.per_diem) {
    out.push({
      code: "per_diem",
      label: "Per diem over limit",
      detail: `${money(Number(trip.per_diem_rate))} per day, limit is ${money(policy.per_diem)}.`,
    });
  }
  return out;
}

export function needsFinanceReview(
  total: number,
  violations: PolicyViolation[],
  policy: TravelPolicy | null,
): boolean {
  if (violations.length > 0) return true;
  if (!policy) return false;
  return total > policy.finance_review_threshold;
}

/** Highest-privilege role, used to pick which policy applies. */
export function primaryRole(roles: AppRole[]): AppRole {
  const order: AppRole[] = ["admin", "finance", "manager", "employee"];
  return order.find((r) => roles.includes(r)) ?? "employee";
}
