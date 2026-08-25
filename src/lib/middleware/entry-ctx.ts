import type { Entry } from "@supabase/middleware";

/**
 * A middleware entry with its type parameters erased — the shape an array of
 * mixed entries has to be constrained to.
 */
export type AnyEntry = Entry<string, object, unknown>;

/**
 * Accumulates the ctx contributions of an entry tuple into one object type.
 *
 * This only works while the tuple is preserved. A `readonly AnyEntry[]`
 * parameter widens it and every contribution collapses to `unknown`, which is
 * why the helpers below declare `<const Entries extends readonly AnyEntry[]>`.
 *
 * Copied from `@supabase/server`'s adapter migration guide, which asks
 * consumers to hand-roll it; the package keeps an identical private copy in
 * `with-supabase.ts`.
 */
export type MiddlewareCtx<Entries extends readonly AnyEntry[]> = Entries extends readonly [
  Entry<infer Key extends string, object, infer Contribution>,
  ...infer Rest,
]
  ? Rest extends readonly AnyEntry[]
    ? { [P in Key]: Contribution } & MiddlewareCtx<Rest>
    : { [P in Key]: Contribution }
  : object;
