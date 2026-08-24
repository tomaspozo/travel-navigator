import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { markNotificationsRead } from "@/lib/notifications.functions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  request_id: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const qc = useQueryClient();
  const markRead = useServerFn(markNotificationsRead);

  const { data } = useQuery<NotificationRow[]>({
    queryKey: ["notifications"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, request_id, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as unknown as NotificationRow[];
    },
  });

  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  async function onOpenChange(open: boolean) {
    if (open && unread > 0) {
      await markRead({});
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label="Notifications">
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
        <ul className="max-h-96 divide-y overflow-y-auto">
          {items.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted-foreground">Nothing yet.</li>
          )}
          {items.map((n) => {
            const content = (
              <div className={n.read_at ? "" : "bg-accent/40"}>
                <div className="px-4 py-3">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">
                    {n.body}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              </div>
            );
            return (
              <li key={n.id}>
                {n.request_id ? (
                  <Link to="/requests/$id" params={{ id: n.request_id }}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
