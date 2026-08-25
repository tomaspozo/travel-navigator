import { createMiddleware } from "@tanstack/react-start";
import { withSupabase } from "@supabase/server";
import type { SupabaseContext, UserClaims, WithSupabaseConfig } from "@supabase/server";

import type { Database } from "@/integrations/supabase/types";
import type { AnyEntry, MiddlewareCtx } from "./entry-ctx";

/**
 * Turn a short-circuit `Response` into a thrown `Error`.
 *
 * This is not defensive tidying — it is required for correctness. TanStack
 * Start's server-fn fetcher returns any `application/json` body as a *value*
 * without consulting the status:
 *
 *     if (contentType.includes("application/json")) {
 *       const jsonPayload = await response.json()
 *       ...
 *       return jsonPayload            // <- status never checked
 *     }
 *     if (!response.ok) throw new Error(await response.text())   // non-JSON only
 *
 * `withSupabase` rejects with `Response.json({ message, code })`, which is
 * JSON — so returning it here would resolve the caller's promise with
 * `{ message: "Invalid credentials", ... }` where it expects its own result
 * type. An unauthenticated request would look like a successful one carrying
 * odd data. Throwing keeps the behaviour identical to the generated middleware
 * this replaces, which threw plain `Error`s.
 */
async function toStartError(response: Response): Promise<Error> {
  let message = `Request failed with status ${response.status}`;
  let code: string | undefined;

  try {
    const body: unknown = await response.clone().json();
    if (body !== null && typeof body === "object") {
      const shape = body as { message?: unknown; code?: unknown };
      if (typeof shape.message === "string") message = shape.message;
      if (typeof shape.code === "string") code = shape.code;
    }
  } catch {
    // Non-JSON body — the status-based message above is the best available.
  }

  // `statusCode` is what src/start.ts's errorMiddleware re-throws on rather
  // than rendering its HTML 500 page.
  return Object.assign(new Error(message), {
    status: response.status,
    statusCode: response.status,
    ...(code !== undefined && { code }),
  });
}

/**
 * The signed-in user's id.
 *
 * `SupabaseContext` types `userClaims` as nullable because the auth mode is not
 * part of the type — but under `auth: 'user'` the request cannot reach the
 * handler without it. This keeps that reasoning in one place instead of
 * scattering non-null assertions across call sites.
 *
 * Note the field is `id`, not `sub`; `UserClaims` is the normalized camelCase
 * view of the raw JWT payload (which is `ctx.jwtClaims`).
 */
export function userId(ctx: { userClaims: UserClaims | null }): string {
  if (!ctx.userClaims) {
    throw new Error("Expected an authenticated user on the request context");
  }
  return ctx.userClaims.id;
}

/**
 * Auth-gated Supabase context for a TanStack Start server function.
 *
 * Replaces the generated `requireSupabaseAuth`. Extra entries compose through
 * `withSupabase`'s own `middleware:` option, **not** through an entry array
 * alongside a hand-wrapped `withSupabase` — that wrapper infers as
 * `Entry<string, object, unknown>`, and the untyped contribution makes any
 * typed entry after it fail with a `middleware-conflict` (see SDK-1614).
 *
 * `cors` is forced off: the default answers `OPTIONS` itself and stamps
 * `Access-Control-Allow-Origin: *` on every response, neither of which belongs
 * on an RLS-backed server function.
 *
 * After SDK-1614 ships a real gate entry this collapses into
 * `toStartMiddleware([withAuth('user'), withSupabaseClient(), ...])`, and
 * handlers read `ctx.jwtClaims.sub` instead of `userId(ctx)` /
 * `ctx.userClaims.id`.
 */
export function supabaseStartMiddleware<const Entries extends readonly AnyEntry[]>(
  config: Omit<WithSupabaseConfig, "cors"> & { middleware: Entries },
) {
  type Ctx = SupabaseContext<Database> & MiddlewareCtx<Entries>;

  return createMiddleware().server<Ctx>(async ({ request, next }) => {
    let handlerRan = false;

    const handler = withSupabase<Database, Entries>(
      { ...config, cors: "disabled" },
      async (_req, ctx) => {
        handlerRan = true;
        return (await next({ context: ctx })).response;
      },
    );

    const response = await handler(request);
    if (handlerRan) return response;

    // Auth rejection or client-construction failure — never reached the handler.
    throw await toStartError(response);
  });
}
