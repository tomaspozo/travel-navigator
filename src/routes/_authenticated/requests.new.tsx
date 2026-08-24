import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

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

  async function submit(asDraft: boolean) {
    if (!me) return;
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
        policy_violations: violations,
        exception_justification: form.exception_justification || null,
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

    setSaving(false);
    toast.success(asDraft ? "Draft saved." : "Request submitted for approval.");
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

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => submit(false)} disabled={saving}>
          Submit for approval
        </Button>
        <Button variant="outline" onClick={() => submit(true)} disabled={saving}>
          Save as draft
        </Button>
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
