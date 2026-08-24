import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { money, STATUS_LABELS, type RequestStatus } from "@/lib/policy";
import { AlertTriangle, Inbox } from "lucide-react";

export const Route = createFileRoute("/_authenticated/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals queue — Voyara" },
      {
        name: "description",
        content:
          "Review travel requests waiting on your decision as a manager or finance approver.",
      },
      { property: "og:title", content: "Approvals queue — Voyara" },
      {
        property: "og:description",
        content: "Travel requests waiting on your approval decision.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Approvals,
});

interface QueueRow {
  id: string;
  destination: string;
  purpose: string;
  start_date: string;
  end_date: string;
  total_budget: number;
  status: RequestStatus;
  requester_id: string;
  policy_violations: { code: string }[];
}

function Approvals() {
  const { data: me } = useAppUser();
  const roles = me?.roles ?? [];
  const isFinance = roles.includes("finance") || roles.includes("admin");

  const { data, isLoading } = useQuery({
    queryKey: ["approval-queue", me?.userId],
    enabled: !!me?.userId,
    queryFn: async () => {
      const { data: reports } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("manager_id", me!.userId);

      const reportIds = (reports ?? []).map((r) => r.id);
      const names = new Map(
        (reports ?? []).map((r) => [r.id, r.full_name || r.email]),
      );

      const statuses: RequestStatus[] = isFinance
        ? ["pending_manager", "pending_finance"]
        : ["pending_manager"];

      const { data: rows, error } = await supabase
        .from("travel_requests")
        .select("*")
        .in("status", statuses)
        .order("submitted_at", { ascending: true });
      if (error) throw error;

      const filtered = ((rows ?? []) as unknown as QueueRow[]).filter((r) => {
        if (r.status === "pending_manager") return reportIds.includes(r.requester_id);
        return isFinance;
      });

      // fill in names for finance-stage requests from people outside the team
      const missing = filtered
        .map((r) => r.requester_id)
        .filter((id) => !names.has(id));
      if (missing.length) {
        const { data: extra } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", missing);
        (extra ?? []).forEach((p) => names.set(p.id, p.full_name || p.email));
      }

      return filtered.map((r) => ({ ...r, requester: names.get(r.requester_id) ?? "—" }));
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-muted-foreground">
          {isFinance
            ? "Requests awaiting your decision as manager, finance or executive."
            : "Requests from your direct reports awaiting your decision."}
        </p>
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <div className="rounded-xl border border-dashed bg-card p-10 text-center">
          <Inbox className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Nothing waiting on you.</p>
        </div>
      )}

      <div className="space-y-3">
        {data?.map((r) => (
          <Link
            key={r.id}
            to="/requests/$id"
            params={{ id: r.id }}
            className="block rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {r.destination}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {r.requester}
                  </span>
                </p>
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {r.purpose}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {r.start_date} → {r.end_date}
                </p>
              </div>
              <div className="text-right">
                <Badge variant="secondary">{STATUS_LABELS[r.status]}</Badge>
                <p className="mt-2 text-lg font-semibold">{money(r.total_budget)}</p>
                {r.policy_violations?.length > 0 && (
                  <p className="mt-1 flex items-center justify-end gap-1 text-xs text-destructive">
                    <AlertTriangle className="size-3.5" /> exception
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
