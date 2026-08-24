import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { notifyRequestEvent } from "@/lib/notifications.functions";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { money, STATUS_LABELS, type RequestStatus } from "@/lib/policy";
import type { AiReview } from "@/lib/ai-review-types";
import { AiReviewPanel } from "@/components/ai-review-panel";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Check,
  MapPin,
  X,
  Luggage,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/requests/$id")({
  head: () => ({
    meta: [
      { title: "Travel request — Voyara" },
      {
        name: "description",
        content:
          "Review a travel request: budget breakdown, policy exceptions and the full approval timeline.",
      },
      { property: "og:title", content: "Travel request — Voyara" },
      {
        property: "og:description",
        content: "Budget, policy exceptions and approval timeline for a trip.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RequestDetail,
});

interface Approval {
  id: string;
  stage: "manager" | "finance";
  decision: "pending" | "approved" | "rejected";
  approver_id: string | null;
  comment: string | null;
  decided_at: string | null;
  created_at: string;
}

function RequestDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useAppUser();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const notify = useServerFn(notifyRequestEvent);

  const { data, isLoading } = useQuery({
    queryKey: ["request", id],
    queryFn: async () => {
      const { data: req, error } = await supabase
        .from("travel_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!req) return null;

      const [{ data: approvals }, { data: requester }] = await Promise.all([
        supabase
          .from("request_approvals")
          .select("*")
          .eq("request_id", id)
          .order("created_at"),
        supabase
          .from("profiles")
          .select("id, full_name, email, manager_id, department")
          .eq("id", req.requester_id)
          .maybeSingle(),
      ]);

      return {
        req: req as unknown as {
          id: string;
          destination: string;
          purpose: string;
          start_date: string;
          end_date: string;
          transportation_type: string;
          transportation_cost: number;
          hotel_name: string | null;
          hotel_nightly_rate: number;
          hotel_nights: number;
          per_diem_rate: number;
          other_costs: number;
          total_budget: number;
          needs_booking_help: boolean;
          policy_violations: { code: string; label: string; detail: string }[];
          ai_review: AiReview | null;
          exception_justification: string | null;
          human_review_requested: boolean;
          human_review_reason: string | null;
          status: RequestStatus;
          requester_id: string;
        },
        approvals: (approvals ?? []) as unknown as Approval[],
        requester: requester as {
          id: string;
          full_name: string;
          email: string;
          manager_id: string | null;
          department: string | null;
        } | null,
      };
    },
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        This request doesn't exist or you don't have access to it.
      </p>
    );
  }

  const { req, approvals, requester } = data;
  const roles = me?.roles ?? [];
  const isManagerOfRequester = requester?.manager_id === me?.userId;
  const isFinance = roles.includes("finance") || roles.includes("admin");

  const canActManager = req.status === "pending_manager" && isManagerOfRequester;
  const canActFinance = req.status === "pending_finance" && isFinance;
  const canAct = canActManager || canActFinance;
  const stage: "manager" | "finance" = canActManager ? "manager" : "finance";

  async function decide(decision: "approved" | "rejected") {
    if (!me) return;
    setBusy(true);

    await supabase
      .from("request_approvals")
      .update({
        decision,
        approver_id: me.userId,
        comment: comment || null,
        decided_at: new Date().toISOString(),
      })
      .eq("request_id", req.id)
      .eq("stage", stage);

    let nextStatus: RequestStatus = "approved";
    if (decision === "rejected") {
      nextStatus = "rejected";
    } else if (stage === "manager") {
      const escalate =
        (req.policy_violations?.length ?? 0) > 0 ||
        Number(req.total_budget) > Number(me.policy?.finance_review_threshold ?? Infinity);
      if (escalate) {
        nextStatus = "pending_finance";
        await supabase
          .from("request_approvals")
          .upsert(
            { request_id: req.id, stage: "finance", decision: "pending" },
            { onConflict: "request_id,stage" },
          );
      }
    }

    const { error } = await supabase
      .from("travel_requests")
      .update({ status: nextStatus })
      .eq("id", req.id);

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    try {
      await notify({
        data: {
          requestId: req.id,
          event: decision === "rejected" ? "rejected" : "approved",
          ...(comment ? { reason: comment } : {}),
        },
      });
      if (nextStatus === "pending_finance") {
        await notify({ data: { requestId: req.id, event: "escalated" } });
      }
    } catch {
      // Notifications must never block the decision itself.
    }

    setComment("");
    toast.success(
      decision === "rejected"
        ? "Request rejected."
        : nextStatus === "pending_finance"
          ? "Approved — escalated to finance."
          : "Request approved.",
    );
    qc.invalidateQueries({ queryKey: ["request", req.id] });
    qc.invalidateQueries({ queryKey: ["approval-queue"] });
  }

  const days =
    Math.round(
      (new Date(req.end_date).getTime() - new Date(req.start_date).getTime()) /
        86_400_000,
    ) + 1;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
        <ArrowLeft className="size-4" /> Back
      </Button>

      <div className="rounded-xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <MapPin className="size-5 text-muted-foreground" />
              {req.destination}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{req.purpose}</p>
            <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <CalendarDays className="size-3.5" />
                {req.start_date} → {req.end_date} ({days} days)
              </span>
              <span>Requested by {requester?.full_name || requester?.email}</span>
            </p>
          </div>
          <div className="text-right">
            <Badge>{STATUS_LABELS[req.status]}</Badge>
            <p className="mt-2 text-2xl font-semibold">{money(req.total_budget)}</p>
          </div>
        </div>

        {req.needs_booking_help && (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
            <Luggage className="size-4" /> Requester needs help with the booking.
          </p>
        )}

        <Separator className="my-6" />

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row label={`Transport (${req.transportation_type})`} value={money(req.transportation_cost)} />
          <Row
            label={`Hotel${req.hotel_name ? ` — ${req.hotel_name}` : ""}`}
            value={`${money(req.hotel_nightly_rate)} × ${req.hotel_nights} nights`}
          />
          <Row label="Per diem" value={`${money(req.per_diem_rate)} / day`} />
          <Row label="Other costs" value={money(req.other_costs)} />
        </dl>
      </div>

      {req.policy_violations?.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" />
            <h2 className="text-sm font-semibold">Policy exceptions</h2>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {req.policy_violations.map((v) => (
              <li key={v.code}>
                <span className="font-medium">{v.label}.</span>{" "}
                <span className="text-muted-foreground">{v.detail}</span>
              </li>
            ))}
          </ul>
          {req.exception_justification && (
            <p className="mt-4 rounded-lg bg-background p-3 text-sm">
              <span className="font-medium">Justification: </span>
              {req.exception_justification}
            </p>
          )}
        </div>
      )}

      {req.ai_review && <AiReviewPanel review={req.ai_review} />}

      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Approval timeline
        </h2>
        <ol className="mt-4 space-y-4">
          {approvals.length === 0 && (
            <li className="text-sm text-muted-foreground">Not submitted yet.</li>
          )}
          {approvals.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span
                className={`mt-1 size-2.5 shrink-0 rounded-full ${
                  a.decision === "approved"
                    ? "bg-primary"
                    : a.decision === "rejected"
                      ? "bg-destructive"
                      : "bg-muted-foreground/40"
                }`}
              />
              <div className="text-sm">
                <p className="font-medium capitalize">
                  {a.stage === "manager" ? "Manager review" : "Finance / executive review"}{" "}
                  <span className="font-normal text-muted-foreground">— {a.decision}</span>
                </p>
                {a.comment && <p className="text-muted-foreground">"{a.comment}"</p>}
                {a.decided_at && (
                  <p className="text-xs text-muted-foreground">
                    {new Date(a.decided_at).toLocaleString()}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {canAct && (
        <div className="space-y-3 rounded-xl border bg-card p-6">
          <h2 className="text-sm font-semibold">
            Your decision ({stage === "manager" ? "manager" : "finance"} stage)
          </h2>
          <Textarea
            rows={3}
            placeholder="Add a comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-3">
            <Button onClick={() => decide("approved")} disabled={busy}>
              <Check className="size-4" /> Approve
            </Button>
            <Button
              variant="destructive"
              onClick={() => decide("rejected")}
              disabled={busy}
            >
              <X className="size-4" /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/60 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
