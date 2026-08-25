import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ApiCallLog {
  id: string;
  endpoint: string;
  payload: Record<string, unknown> | null;
  key_fingerprint: string | null;
  created_at: string;
}

const ENDPOINTS = [
  { value: "all", label: "All endpoints" },
  { value: "ai/review", label: "AI review" },
  { value: "email/send", label: "Email send" },
  { value: "cron/pending-reviews", label: "Daily reminders" },
];

const OUTCOMES = [
  { value: "all", label: "Any status" },
  { value: "success", label: "Success" },
  { value: "provider_error", label: "Provider error" },
  { value: "network_error", label: "Network error" },
  { value: "skipped_not_configured", label: "Skipped (not configured)" },
];

const RANGES = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "all", label: "All time", hours: 0 },
];

function outcomeVariant(outcome: string | undefined) {
  if (outcome === "success") return "default" as const;
  if (outcome === "provider_error" || outcome === "network_error")
    return "destructive" as const;
  return "secondary" as const;
}

export function ApiLogPanel() {
  const [endpoint, setEndpoint] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [range, setRange] = useState("7d");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["api-call-logs", endpoint, outcome, range],
    queryFn: async () => {
      let q = supabase
        .from("api_call_logs")
        .select("id, endpoint, payload, key_fingerprint, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (endpoint !== "all") q = q.eq("endpoint", endpoint);
      if (outcome !== "all") q = q.filter("payload->>outcome", "eq", outcome);

      const hours = RANGES.find((r) => r.value === range)?.hours ?? 0;
      if (hours > 0) {
        q = q.gte("created_at", new Date(Date.now() - hours * 3600_000).toISOString());
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ApiCallLog[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52 space-y-1">
          <Label className="text-xs text-muted-foreground">Endpoint</Label>
          <Select value={endpoint} onValueChange={setEndpoint}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENDPOINTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-52 space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44 space-y-1">
          <Label className="text-xs text-muted-foreground">Time range</Label>
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="text-sm text-muted-foreground">
          No API calls recorded for these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Key</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.map((log) => {
                const payload = (log.payload ?? {}) as Record<string, unknown>;
                const status = payload["outcome"] as string | undefined;
                return (
                  <tr key={log.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium">
                      {log.endpoint}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={outcomeVariant(status)}>{status ?? "—"}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {log.key_fingerprint ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <pre className="max-w-md whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
                        {JSON.stringify(payload, null, 1)}
                      </pre>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
