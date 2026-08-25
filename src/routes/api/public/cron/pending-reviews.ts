import { createFileRoute } from "@tanstack/react-router";

/**
 * Daily job: remind reviewers/admins about travel requests still waiting.
 *
 * The handler lives in a `.server.ts` module and is imported lazily: route
 * files ship to the client bundle, and this is what keeps `@supabase/server`
 * (and the secret key it resolves) out of it.
 */
export const Route = createFileRoute("/api/public/cron/pending-reviews")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handlePendingReviews } = await import("@/lib/cron/pending-reviews.server");
        return handlePendingReviews(request);
      },
    },
  },
});
