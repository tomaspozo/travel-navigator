import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { runAiReview } from "@/lib/ai-review.functions";
import { notifyRequestEvent } from "@/lib/notifications.functions";
import { reviewHasFailures, type AiReview } from "@/lib/ai-review-types";
import { AiReviewPanel } from "@/components/ai-review-panel";


import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  evaluatePolicy,
  money,
  needsFinanceReview,
  totalBudget,
  tripDays,
} from "@/lib/policy";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/requests/new")({
  head: () => ({
    meta: [
      { title: "New travel request — Voyara" },
      {
        name: "description",
        content:
          "Submit a travel request with destination, purpose, dates, transport, hotel and per diem, checked live against your travel policy.",
      },
      { property: "og:title", content: "New travel request — Voyara" },
      {
        property: "og:description",
        content: "Create a policy-checked travel request for approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewRequest,
});

const TRANSPORT = ["flight", "train", "car rental", "personal car", "bus", "other"];

function NewRequest() {
  const navigate = useNavigate();
  const { data: me } = useAppUser();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    destination: "",
    purpose: "",
    start_date: "",
    end_date: "",
    transportation_type: "flight",
    transportation_cost: 0,
    hotel_name: "",
    hotel_nightly_rate: 0,
    hotel_nights: 0,
    per_diem_rate: 0,
    other_costs: 0,
    needs_booking_help: false,
    exception_justification: "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const days = tripDays(form.start_date, form.end_date);
  const total = useMemo(() => totalBudget(form), [form]);
  const violations = useMemo(
    () => evaluatePolicy(form, me?.policy ?? null),
    [form, me?.policy],
  );
  const financeNeeded = needsFinanceReview(total, violations, me?.policy ?? null);

  const reviewFn = useServerFn(runAiReview);
  const notify = useServerFn(notifyRequestEvent);
  const [humanReason, setHumanReason] = useState("");
  const [askHuman, setAskHuman] = useState(false);
  const [review, setReview] = useState<AiReview | null>(null);
  const [reviewing, setReviewing] = useState(false);

  // Any change to the reviewed content invalidates the previous AI verdict.
  const reviewKey = JSON.stringify([
    form.destination,
    form.purpose,
    form.start_date,
    form.end_date,
    form.transportation_type,
    form.transportation_cost,
    form.hotel_nightly_rate,
    form.hotel_nights,
    form.per_diem_rate,
    form.other_costs,
  ]);
  useEffect(() => {
    setReview(null);
  }, [reviewKey]);

  async function checkWithAi(): Promise<AiReview | null> {
    if (!form.destination || !form.purpose || !form.start_date || !form.end_date) {
      toast.error("Fill destination, purpose and dates before running the AI check.");
      return null;
    }
    setReviewing(true);
    try {
      const result = await reviewFn({
        data: {
          destination: form.destination,
          purpose: form.purpose,
          start_date: form.start_date,
          end_date: form.end_date,
          trip_days: days,
          transportation_type: form.transportation_type,
          transportation_cost: Number(form.transportation_cost),
          hotel_nightly_rate: Number(form.hotel_nightly_rate),
          hotel_nights: Number(form.hotel_nights),
          per_diem_rate: Number(form.per_diem_rate),
          other_costs: Number(form.other_costs),
          total_budget: total,
        },
      });
      setReview(result);
      return result;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The AI review failed.");
      return null;
    } finally {
      setReviewing(false);
    }
  }

  async function submit(mode: "draft" | "submit" | "human") {
    if (!me) return;
    const asDraft = mode === "draft";
    if (!form.destination || !form.purpose || !form.start_date || !form.end_date) {
      toast.error("Destination, purpose and dates are required.");
      return;
    }
    if (days <= 0) {
      toast.error("End date must be on or after the start date.");
      return;
    }
    if (!asDraft && violations.length > 0 && form.exception_justification.trim().length < 10) {
      toast.error("This trip breaks policy — add a justification (10+ characters).");
      return;
    }
    if (mode === "human" && humanReason.trim().length < 10) {
      toast.error("Tell the admins why the AI check is wrong (10+ characters).");
      return;
    }

    let aiReview = review;
    if (mode === "submit") {
      if (!aiReview) {
        aiReview = await checkWithAi();
        if (!aiReview) return;
      }
      if (reviewHasFailures(aiReview)) {
        toast.error("The AI review found blocking issues — fix them, or request a human review.");
        return;
      }
    }




    setSaving(true);
    const hasManager = !!me.profile?.manager_id;
    const status = asDraft
      ? "draft"
      : hasManager
        ? "pending_manager"
        : "pending_finance";

    const { data, error } = await supabase
      .from("travel_requests")
      .insert({
        requester_id: me.userId,
        destination: form.destination,
        purpose: form.purpose,
        start_date: form.start_date,
        end_date: form.end_date,
        transportation_type: form.transportation_type,
        transportation_cost: form.transportation_cost,
        hotel_name: form.hotel_name || null,
        hotel_nightly_rate: form.hotel_nightly_rate,
        hotel_nights: form.hotel_nights,
        per_diem_rate: form.per_diem_rate,
        other_costs: form.other_costs,
        total_budget: total,
        needs_booking_help: form.needs_booking_help,
        policy_violations: violations as unknown as never,
        ai_review: (aiReview ?? null) as unknown as never,
        ai_reviewed_at: aiReview?.reviewed_at ?? null,
        exception_justification: form.exception_justification || null,
        human_review_requested: mode === "human",
        human_review_reason: mode === "human" ? humanReason : null,
        status,
        submitted_at: asDraft ? null : new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      setSaving(false);
      toast.error(error?.message ?? "Could not save the request.");
      return;
    }

    if (!asDraft) {
      await supabase.from("request_approvals").insert({
        request_id: data.id,
        stage: hasManager ? "manager" : "finance",
        decision: "pending",
      });
    }

    if (!asDraft) {
      try {
        await notify({ data: { requestId: data.id, event: "submitted" } });
        if (mode === "human") {
          await notify({
            data: {
              requestId: data.id,
              event: "human_review_requested",
              reason: humanReason,
            },
          });
        }
      } catch {
        // Never block the submission on notification delivery.
      }
    }

    setSaving(false);
    toast.success(
      asDraft
        ? "Draft saved."
        : mode === "human"
          ? "Sent for human review — admins have been notified."
          : "Request submitted for approval.",
    );
    navigate({ to: "/requests/$id", params: { id: data.id } });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/dashboard" })}>
        <ArrowLeft className="size-4" /> Back
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New travel request</h1>
        <p className="text-sm text-muted-foreground">
          Costs are checked live against your travel policy.
        </p>
      </div>

      <section className="space-y-4 rounded-xl border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Trip
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Destination" htmlFor="destination">
            <Input
              id="destination"
              placeholder="Berlin, Germany"
              value={form.destination}
              onChange={(e) => set("destination", e.target.value)}
            />
          </Field>
          <Field label="Transportation" htmlFor="transport">
            <Select
              value={form.transportation_type}
              onValueChange={(v) => set("transportation_type", v)}
            >
              <SelectTrigger id="transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSPORT.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Purpose of the trip" htmlFor="purpose">
          <Textarea
            id="purpose"
            rows={3}
            placeholder="Customer onboarding workshop with ACME…"
            value={form.purpose}
            onChange={(e) => set("purpose", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="start">
            <Input
              id="start"
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          </Field>
          <Field label="End date" htmlFor="end">
            <Input
              id="end"
              type="date"
              value={form.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Budget
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ticket / transport cost" htmlFor="tcost">
            <Input
              id="tcost"
              type="number"
              min={0}
              value={form.transportation_cost}
              onChange={(e) => set("transportation_cost", Number(e.target.value))}
            />
          </Field>
          <Field label="Hotel" htmlFor="hotel">
            <Input
              id="hotel"
              placeholder="Hotel name (optional)"
              value={form.hotel_name}
              onChange={(e) => set("hotel_name", e.target.value)}
            />
          </Field>
          <Field label="Hotel rate per night" htmlFor="hrate">
            <Input
              id="hrate"
              type="number"
              min={0}
              value={form.hotel_nightly_rate}
              onChange={(e) => set("hotel_nightly_rate", Number(e.target.value))}
            />
          </Field>
          <Field label="Nights" htmlFor="nights">
            <Input
              id="nights"
              type="number"
              min={0}
              value={form.hotel_nights}
              onChange={(e) => set("hotel_nights", Number(e.target.value))}
            />
          </Field>
          <Field label="Per diem per day" htmlFor="pd">
            <Input
              id="pd"
              type="number"
              min={0}
              value={form.per_diem_rate}
              onChange={(e) => set("per_diem_rate", Number(e.target.value))}
            />
          </Field>
          <Field label="Other costs" htmlFor="other">
            <Input
              id="other"
              type="number"
              min={0}
              value={form.other_costs}
              onChange={(e) => set("other_costs", Number(e.target.value))}
            />
          </Field>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {days > 0 ? `${days} day${days > 1 ? "s" : ""}` : "Dates not set"}
          </span>
          <span className="text-lg font-semibold">{money(total)}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div>
            <Label htmlFor="booking">I need help with the booking</Label>
            <p className="text-xs text-muted-foreground">
              Travel ops will book flights and hotel for you.
            </p>
          </div>
          <Switch
            id="booking"
            checked={form.needs_booking_help}
            onCheckedChange={(v) => set("needs_booking_help", v)}
          />
        </div>
      </section>

      {violations.length > 0 && (
        <section className="space-y-4 rounded-xl border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" />
            <h2 className="text-sm font-semibold">Policy exceptions</h2>
          </div>
          <ul className="space-y-2 text-sm">
            {violations.map((v) => (
              <li key={v.code}>
                <span className="font-medium">{v.label}.</span>{" "}
                <span className="text-muted-foreground">{v.detail}</span>
              </li>
            ))}
          </ul>
          <Field label="Justification (required)" htmlFor="just">
            <Textarea
              id="just"
              rows={3}
              placeholder="Why does this trip need an exception?"
              value={form.exception_justification}
              onChange={(e) => set("exception_justification", e.target.value)}
            />
          </Field>
        </section>
      )}

      {review ? (
        <AiReviewPanel review={review} />
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-6">
          <div>
            <h2 className="text-sm font-semibold">AI review</h2>
            <p className="text-sm text-muted-foreground">
              Checks your description, whether the trip matches an approved trip type, and
              whether the budget is realistic for {form.destination || "the destination"}.
            </p>
          </div>
          <Button variant="secondary" onClick={checkWithAi} disabled={reviewing}>
            {reviewing ? "Reviewing…" : "Run AI check"}
          </Button>
        </section>
      )}

      {askHuman && (
        <section className="space-y-3 rounded-xl border bg-card p-6">
          <div>
            <h2 className="text-sm font-semibold">Request human review</h2>
            <p className="text-sm text-muted-foreground">
              Skip the AI verdict and send this trip straight to an admin. Explain why you
              think the AI check is wrong.
            </p>
          </div>
          <Textarea
            rows={3}
            placeholder="The AI flagged the hotel rate, but this is a conference-week rate in the venue hotel…"
            value={humanReason}
            onChange={(e) => setHumanReason(e.target.value)}
          />
          <div className="flex gap-3">
            <Button onClick={() => submit("human")} disabled={saving}>
              Send to an admin
            </Button>
            <Button variant="ghost" onClick={() => setAskHuman(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => submit("submit")} disabled={saving || reviewing}>
          Submit for approval
        </Button>
        <Button variant="outline" onClick={() => submit("draft")} disabled={saving}>
          Save as draft
        </Button>
        {!askHuman && (
          <Button variant="ghost" onClick={() => setAskHuman(true)} disabled={saving}>
            Request human review
          </Button>
        )}
        {review && (
          <Button variant="ghost" onClick={checkWithAi} disabled={reviewing}>
            {reviewing ? "Reviewing…" : "Re-run AI check"}
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          {financeNeeded
            ? "This request will need finance/executive sign-off after your manager."
            : "Your manager can approve this request directly."}
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
