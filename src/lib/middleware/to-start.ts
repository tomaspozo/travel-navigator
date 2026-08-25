import { createMiddleware } from "@tanstack/react-start";
import { pipeline } from "@supabase/middleware";

import type { AnyEntry, MiddlewareCtx } from "./entry-ctx";

/**
 * Runs an array of `@supabase/middleware` entries inside a TanStack Start
 * middleware slot.
 *
 * Three differences from the helper published in `@supabase/server`'s adapter
 * migration guide, all deliberate:
 *
 * 1. `<const Entries>` keeps the tuple. The guide's `readonly AnyEntry[]`
 *    parameter widens it, so every `context.*` read comes back `unknown`.
 * 2. `.server<MiddlewareCtx<Entries>>` supplies the accumulated context type.
 *    `server` is `<TServerContext = undefined>(fn)` with no constraint, so
 *    without this argument it defaults to `undefined` and the typing is lost
 *    even with the tuple intact.
 * 3. `pipeline` instead of a hand-rolled `reduceRight`, which restores the
 *    compile-time prerequisite and key-collision checks the manual fold throws
 *    away.
 *
 * `createMiddleware()` with no argument produces a *request* middleware, whose
 * server function is allowed to return a `Response` — which is what lets an
 * entry short-circuit.
 *
 * Do not put a hand-wrapped `withSupabase` in this array. It infers as
 * `Entry<string, object, unknown>`, and that untyped contribution makes any
 * typed entry after it fail with a `middleware-conflict`. Compose through
 * `withSupabase`'s own `middleware:` option instead — see `supabase-start.ts`.
 */
export function toStartMiddleware<const Entries extends readonly AnyEntry[]>(entries: Entries) {
  return createMiddleware().server<MiddlewareCtx<Entries>>(async ({ request, next }) => {
    // The terminal closes over `next`, so the pipeline is built per request.
    // That is a reduceRight over a handful of entries, not real work.
    const composed = pipeline(
      entries,
      async (_req, ctx) => (await next({ context: ctx })).response,
    );
    return composed(request);
  });
}
