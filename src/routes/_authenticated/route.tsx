import {
  createFileRoute,
  Outlet,
  redirect,
  Link,
  useNavigate,
} from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { useAppUser } from "@/hooks/use-app-user";
import { Button } from "@/components/ui/button";
import { Plane, LayoutDashboard, Inbox, Settings, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const navigate = useNavigate();
  const { data: me } = useAppUser();
  const roles = me?.roles ?? [];
  const canReview =
    roles.includes("manager") || roles.includes("finance") || roles.includes("admin");
  const isAdmin = roles.includes("admin");

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-4">
          <Link to="/dashboard" className="mr-4 flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Plane className="size-4" />
            </span>
            <span className="font-semibold tracking-tight">Voyara</span>
          </Link>

          <NavLink to="/dashboard" icon={<LayoutDashboard className="size-4" />}>
            My trips
          </NavLink>
          {canReview && (
            <NavLink to="/approvals" icon={<Inbox className="size-4" />}>
              Approvals
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" icon={<Settings className="size-4" />}>
              Admin
            </NavLink>
          )}

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {me?.profile?.full_name || me?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="size-4" />
              <span className="sr-only sm:not-sr-only">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      activeProps={{ className: "bg-accent text-accent-foreground" }}
      className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Link>
  );
}
