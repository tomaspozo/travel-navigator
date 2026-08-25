import { defineMiddleware } from "@supabase/middleware";
import type { Middleware } from "@supabase/middleware";

import { consumeLastCapturedError } from "@/lib/error-capture";

export interface ErrorReporter {
  /** Record a failure the request survived, without changing the response. */
  capture(error: unknown, context?: Record<string, unknown>): void;
}

export interface WithLovableErrorsConfig {
  /** Renders the HTML shown for an unhandled server error. */
  renderPage: () => string;
  /** Hook for forwarding to telemetry. Defaults to console.error. */
  onCapture?: (error: unknown, context?: Record<string, unknown>) => void;
}

/** h3 turns an unhandled throw into this exact JSON body, stack discarded. */
function isH3SwallowedError(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Contributes `ctx.errorReporter`, and owns the way out.
 *
 * This is the one middleware here that genuinely needs the response seam —
 * written as `async function*`, where `yield` suspends until the downstream
 * `Response` comes back. It replaces two hand-rolled pieces that were reaching
 * for exactly this shape and could not express it:
 *
 *   - `src/start.ts`'s errorMiddleware, a try/catch around `next()`.
 *   - `src/server.ts`'s normalizeCatastrophicSsrResponse, which sniffed every
 *     500 response body because h3 had already swallowed the throw.
 *
 * What deliberately does NOT move here is the `console.error` patch in
 * `error-capture.ts`. It exists to intercept h3's *internal* unhandled-error
 * logging, which happens outside any handler this engine can wrap — there is no
 * seam for it. This middleware consumes what that patch records.
 */
export const withLovableErrors: Middleware<
  "errorReporter",
  WithLovableErrorsConfig,
  Record<never, never>,
  ErrorReporter
> = defineMiddleware<"errorReporter", WithLovableErrorsConfig, Record<never, never>, ErrorReporter>(
  {
    key: "errorReporter",
    run: (config) =>
      async function* (_req) {
        const report = (error: unknown, context?: Record<string, unknown>) => {
          if (config.onCapture) config.onCapture(error, context);
          else console.error(error);
        };

        const errorPage = () =>
          new Response(config.renderPage(), {
            status: 500,
            headers: { "content-type": "text/html; charset=utf-8" },
          });

        let response: Response;
        try {
          // Request phase ends here; resumes with the downstream Response.
          response = yield { errorReporter: { capture: report } };
        } catch (error) {
          // A real throw, caught before h3 can flatten it — full stack intact.
          // Anything already carrying a status is a deliberate HTTP outcome
          // (a redirect, a 404) and must be left alone.
          if (
            error != null &&
            typeof error === "object" &&
            ("statusCode" in error || "status" in error)
          ) {
            throw error;
          }
          report(error);
          return errorPage();
        }

        // h3 swallowed the throw into a generic 500 before we could see it.
        // Recover the original via the console.error patch and render properly.
        if (
          response.status >= 500 &&
          (response.headers.get("content-type") ?? "").includes("application/json")
        ) {
          const body = await response.clone().text();
          if (isH3SwallowedError(body)) {
            report(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
            return errorPage();
          }
        }

        return response;
      },
  },
);
