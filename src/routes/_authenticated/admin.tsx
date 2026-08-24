import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAppUser, useTeamProfiles } from "@/hooks/use-app-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLE_LABELS, type AppRole, type TravelPolicy } from "@/lib/policy";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — policies & people | Voyara" },
      {
        name: "description",
        content:
          "Edit travel policy limits per role and manage who is an employee, manager, finance approver or admin.",
      },
      { property: "og:title", content: "Admin — policies & people | Voyara" },
      {
        property: "og:description",
        content: "Manage travel policy limits and team roles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Admin,
});

const ALL_ROLES: AppRole[] = ["employee", "manager", "finance", "admin"];

function Admin() {
  const { data: me } = useAppUser();
  const isAdmin = me?.roles.includes("admin");

  if (me && !isAdmin) {
    return (
      <p className="text-sm text-muted-foreground">
        You need admin access to view this page.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Travel policies per role, and who holds which role.
        </p>
      </div>

      <Tabs defaultValue="policies">
        <TabsList>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="people">People &amp; roles</TabsTrigger>
        </TabsList>
        <TabsContent value="policies" className="pt-4">
          <PoliciesPanel />
        </TabsContent>
        <TabsContent value="people" className="pt-4">
          <PeoplePanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PoliciesPanel() {
  const qc = useQueryClient();
  const { data: policies, isLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("travel_policies")
        .select("*")
        .order("role");
      if (error) throw error;
      return (data ?? []) as unknown as TravelPolicy[];
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      {policies?.map((p) => (
        <PolicyCard
          key={p.id}
          policy={p}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["policies"] });
            qc.invalidateQueries({ queryKey: ["app-user"] });
          }}
        />
      ))}
    </div>
  );
}

function PolicyCard({
  policy,
  onSaved,
}: {
  policy: TravelPolicy;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(policy);
  const [eventTypes, setEventTypes] = useState((policy.event_types ?? []).join(", "));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("travel_policies")
      .update({
        max_trip_days: Number(form.max_trip_days),
        max_ticket_price: Number(form.max_ticket_price),
        max_hotel_per_night: Number(form.max_hotel_per_night),
        per_diem: Number(form.per_diem),
        finance_review_threshold: Number(form.finance_review_threshold),
        event_types: eventTypes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      } as never)
      .eq("id", policy.id);
    setSaving(false);
    if (error) return void toast.error(error.message);
    toast.success(`${ROLE_LABELS[policy.role]} policy updated.`);
    onSaved();
  }

  const num = (key: keyof TravelPolicy, label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`${policy.id}-${String(key)}`}>{label}</Label>
      <Input
        id={`${policy.id}-${String(key)}`}
        type="number"
        min={0}
        value={String(form[key])}
        onChange={(e) =>
          setForm((f) => ({ ...f, [key]: Number(e.target.value) }) as TravelPolicy)
        }
      />
    </div>
  );

  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{ROLE_LABELS[policy.role]}</h2>
        <Button size="sm" onClick={save} disabled={saving}>
          Save
        </Button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {num("max_trip_days", "Max trip days")}
        {num("max_ticket_price", "Max ticket")}
        {num("max_hotel_per_night", "Max hotel / night")}
        {num("per_diem", "Per diem")}
        {num("finance_review_threshold", "Finance review over")}
      </div>
      <div className="mt-4 space-y-2">
        <Label htmlFor={`${policy.id}-events`}>
          Approved trip / event types (comma separated)
        </Label>
        <Textarea
          id={`${policy.id}-events`}
          rows={2}
          placeholder="client meeting, conference, training…"
          value={eventTypes}
          onChange={(e) => setEventTypes(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          The AI reviewer checks each request description against this list.
        </p>
      </div>
    </div>
  );
}

function PeoplePanel() {
  const qc = useQueryClient();
  const { data: profiles } = useTeamProfiles();

  const { data: roleRows } = useQuery({
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      return (data ?? []) as { user_id: string; role: AppRole }[];
    },
  });

  async function toggleRole(userId: string, role: AppRole, has: boolean) {
    const { error } = has
      ? await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role)
      : await supabase.from("user_roles").insert({ user_id: userId, role });
    if (error) return void toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["all-roles"] });
    qc.invalidateQueries({ queryKey: ["app-user"] });
  }

  async function setManager(userId: string, managerId: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ manager_id: managerId === "none" ? null : managerId })
      .eq("id", userId);
    if (error) return void toast.error(error.message);
    toast.success("Manager updated.");
    qc.invalidateQueries({ queryKey: ["profiles"] });
    qc.invalidateQueries({ queryKey: ["app-user"] });
  }

  return (
    <div className="space-y-3">
      {profiles?.map((p) => {
        const roles = (roleRows ?? [])
          .filter((r) => r.user_id === p.id)
          .map((r) => r.role);
        return (
          <div key={p.id} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium">{p.full_name || p.email}</p>
                <p className="text-sm text-muted-foreground">{p.email}</p>
              </div>
              <div className="w-56">
                <Label className="text-xs text-muted-foreground">Reports to</Label>
                <Select
                  value={p.manager_id ?? "none"}
                  onValueChange={(v) => setManager(p.id, v)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No manager</SelectItem>
                    {profiles
                      .filter((o) => o.id !== p.id)
                      .map((o) => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.full_name || o.email}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {ALL_ROLES.map((role) => {
                const has = roles.includes(role);
                return (
                  <button key={role} onClick={() => toggleRole(p.id, role, has)}>
                    <Badge variant={has ? "default" : "outline"} className="cursor-pointer">
                      {ROLE_LABELS[role]}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
