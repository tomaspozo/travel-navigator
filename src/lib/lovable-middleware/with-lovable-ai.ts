import { defineMiddleware, getEnv } from "@supabase/middleware";
import type { Middleware } from "@supabase/middleware";

const DEFAULT_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

/** Why a tool call did not produce a result. */
export type LovableAIFailure =
  "not_configured" | "rate_limited" | "credits_exhausted" | "unavailable" | "malformed_response";

export type LovableAIResult =
  { ok: true; arguments: string } | { ok: false; reason: LovableAIFailure; message: string };

export interface LovableAIToolCall {
  prompt: string;
  tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LovableAI {
  /** False when no API key is configured; calls then fail cleanly rather than throwing. */
  readonly configured: boolean;
  readonly model: string;
  /** Force a single tool call and return its raw JSON `arguments` string. */
  toolCall(call: LovableAIToolCall): Promise<LovableAIResult>;
}

export interface WithLovableAIConfig {
  model?: string;
  gatewayUrl?: string;
  /** Env var holding the gateway key. Override only for testing. */
  apiKeyEnv?: string;
}

/**
 * Contributes `ctx.lovableAI` — a small client for the Lovable AI gateway.
 *
 * This is platform glue, not Supabase glue: the gateway URL, the key, and the
 * meaning of its status codes are facts about Lovable, not about this app.
 * Today every project that uses AI re-writes them by hand, including the
 * wording of `402 -> "AI credits are exhausted for this workspace"`, which is
 * their billing model living in an application file.
 *
 * Failures come back as typed results rather than thrown strings, so a caller
 * can distinguish "out of credits" from "rate limited" from "never configured"
 * without matching on message text. Callers that want the old loud behaviour
 * turn a result into a throw at the edge — see `ai-review.functions.ts`.
 *
 * Bundling note: because `.middleware([...])` lives in a `*.functions.ts` file
 * that ships to the client, this module is client-reachable and its chunk
 * (~1.4 KB) is emitted into the client build — the gateway URL and the *name*
 * `LOVABLE_API_KEY`, never its value. Neither `withSupabase` nor `jose` follows,
 * because those are referenced only inside the stripped `.server()` body.
 * Deferring construction behind a factory or a dynamic `import()` does not
 * change this: a dynamic import still emits the chunk. Keep secrets out of
 * module scope here — reading them through `getEnv` at request time, as below,
 * is what makes that safe.
 *
 * The key is read through `getEnv` on first use, never at module load:
 * on Workers (this template's production target) env bindings arrive per
 * request and are not ambient, so reading in the outer `(config) =>` stage
 * would always see `undefined`.
 */
export const withLovableAI: Middleware<
  "lovableAI",
  WithLovableAIConfig | void,
  Record<never, never>,
  LovableAI
> = defineMiddleware<"lovableAI", WithLovableAIConfig | void, Record<never, never>, LovableAI>({
  key: "lovableAI",
  run: (config) => async () => {
    const gatewayUrl = config?.gatewayUrl ?? DEFAULT_GATEWAY;
    const model = config?.model ?? DEFAULT_MODEL;
    const apiKey = getEnv(config?.apiKeyEnv ?? "LOVABLE_API_KEY");

    const lovableAI: LovableAI = {
      configured: Boolean(apiKey),
      model,
      async toolCall({ prompt, tool }) {
        if (!apiKey) {
          return {
            ok: false,
            reason: "not_configured",
            message: "AI review is not configured for this project.",
          };
        }

        let res: Response;
        try {
          res = await fetch(gatewayUrl, {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              tools: [{ type: "function", function: tool }],
              tool_choice: { type: "function", function: { name: tool.name } },
            }),
          });
        } catch {
          return {
            ok: false,
            reason: "unavailable",
            message: "The AI reviewer is unavailable right now.",
          };
        }

        // The two status codes that are Lovable-specific rather than HTTP-generic.
        if (res.status === 429) {
          return {
            ok: false,
            reason: "rate_limited",
            message: "AI review is rate limited — try again in a moment.",
          };
        }
        if (res.status === 402) {
          return {
            ok: false,
            reason: "credits_exhausted",
            message: "AI credits are exhausted for this workspace.",
          };
        }
        if (!res.ok) {
          console.error("[lovable-ai] gateway error", res.status, await res.text());
          return {
            ok: false,
            reason: "unavailable",
            message: "The AI reviewer is unavailable right now.",
          };
        }

        const payload = (await res.json()) as {
          choices?: {
            message?: { tool_calls?: { function?: { arguments?: string } }[] };
          }[];
        };
        const args = payload.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

        if (typeof args !== "string") {
          return {
            ok: false,
            reason: "malformed_response",
            message: "The AI reviewer returned no result.",
          };
        }
        return { ok: true, arguments: args };
      },
    };

    return { lovableAI };
  },
});
