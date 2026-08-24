import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Plane, ShieldCheck, GitBranch, Luggage } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Voyara — Travel request & approval workflow" },
      {
        name: "description",
        content:
          "Voyara lets teams request business trips, checks every budget against role-based travel policy, and routes approvals through manager and finance review.",
      },
      { property: "og:title", content: "Voyara — Travel request & approval workflow" },
      {
        property: "og:description",
        content:
          "Request trips, flag policy exceptions and route approvals through manager and finance in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Plane className="size-4" />
          </span>
          <span className="font-semibold tracking-tight">Voyara</span>
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Sign in</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-4">
        <section className="py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Travel requests that already know your policy
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-muted-foreground">
            Team members request a trip with destination, purpose and budget. Voyara
            checks it against the limits for their role, flags exceptions, and routes it
            to the right approvers.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          <Feature
            icon={<ShieldCheck className="size-5" />}
            title="Role-based policies"
            body="Trip length, ticket price, hotel rate and per diem limits per role — editable by admins at any time."
          />
          <Feature
            icon={<GitBranch className="size-5" />}
            title="Two-step approval"
            body="Manager approves first. Exceptions and high-cost trips escalate to finance or an executive."
          />
          <Feature
            icon={<Luggage className="size-5" />}
            title="Booking help"
            body="Requesters can flag that they need travel ops to handle flights and hotel for them."
          />
        </section>
      </main>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </span>
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
