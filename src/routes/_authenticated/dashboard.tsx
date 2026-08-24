import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, STATUS_LABELS, type RequestStatus } from "@/lib/policy";
import { Plus, MapPin, CalendarDays, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My trips — Voyara Travel Approvals" },
      {
        name: "description",
        content:
          "Track your travel requests, their approval stage, budgets and any policy exceptions.",
      },
      { property: "og:title", content: "My trips — Voyara Travel Approvals" },
      {
        property: "og:description",
        content: "Track your travel requests and their approval status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

export interface RequestRow {
  id: string;
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  status: RequestStatus;
  needs_booking_help: boolean;
  policy_violations: { code: string; label: string; detail: string }[];
  requester_id: string;
  created_at: string;
}

export function statusVariant(status: RequestStatus) {
  if (status === "approved") return "default" as const;
  if (status === "rejected" || status === "cancelled") return "destructive" as const;
  if (status === "draft") return "outline" as const;
  return "secondary" as const;
}

function Dashboard() {
  const { data: me } = useAppUser();

  const { data: requests, isLoading } = useQuery({
    queryKey: ["my-requests", me?.userId],
    enabled: !!me?.userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_requests")
        .select("*")
        .eq("requester_id", me!.userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RequestRow[];
    },
  });

  const policy = me?.policy;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My trips</h1>
          <p className="text-sm text-muted-foreground">
            Request a trip, track approvals and see policy exceptions.
          </p>
        </div>
        <Button asChild>
          <Link to="/requests/new">
            <Plus className="size-4" /> New request
          </Link>
        </Button>
      </div>

      {policy && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PolicyStat label="Max trip length" value={`${policy.max_trip_days} days`} />
          <PolicyStat label="Max ticket" value={money(policy.max_ticket_price)} />
          <PolicyStat label="Max hotel / night" value={money(policy.max_hotel_per_night)} />
          <PolicyStat label="Per diem" value={money(policy.per_diem)} />
        </div>
      )}

      <div className="space-y-3">
        {isLoading && <Skeleton className="h-24 w-full" />}
        {!isLoading && (requests?.length ?? 0) === 0 && (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">
              No travel requests yet. Create your first one.
            </p>
          </div>
        )}
        {requests?.map((r) => (
          <Link
            key={r.id}
            to="/requests/$id"
            params={{ id: r.id }}
            className="block rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 text-muted-foreground" />
                  <span className="font-medium">{r.destination}</span>
                  {r.needs_booking_help && (
                    <Badge variant="outline">Booking help</Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {r.purpose}
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  {r.start_date} → {r.end_date}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={statusVariant(r.status)}>
                  {STATUS_LABELS[r.status]}
                </Badge>
                <p className="mt-2 text-lg font-semibold">{money(r.total_budget)}</p>
                {r.policy_violations?.length > 0 && (
                  <p className="mt-1 flex items-center justify-end gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3.5" />
                    {r.policy_violations.length} exception
                    {r.policy_violations.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PolicyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
