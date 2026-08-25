import { defineMiddleware, getEnv } from "@supabase/middleware";
import type { Middleware } from "@supabase/middleware";

/** One outbound message. The app owns how it is rendered. */
export interface OutboundEmail {
  to: string;
  subject: string;
  heading: string;
  body: string;
  actionUrl?: string | undefined;
  actionLabel?: string | undefined;
}

export interface LovableEmail {
  /** False when no provider key or sender address is configured. */
  readonly enabled: boolean;
  /**
   * Returns true **only when the message was actually handed to the provider**.
   * Callers rely on this to record delivery honestly — see `notifyUsers`.
   */
  send(mail: OutboundEmail): Promise<boolean>;
}

export interface WithLovableEmailConfig {
  /** Renders the HTML body. Kept in app code: branding is not platform glue. */
  render: (mail: OutboundEmail) => string;
  apiKeyEnv?: string;
  senderEnv?: string;
}

/**
 * Contributes `ctx.email` — outbound delivery for a Lovable project.
 *
 * Delivery is platform work; wording and design are the app's. That split is
 * what keeps this useful rather than restrictive, so the template comes in as
 * config rather than being owned here.
 *
 * `send` returning a boolean is a deliberate contract, not a convenience. The
 * caller writes `emailed_at` only when it is true, so an in-app notification
 * never claims an email went out when it did not. A refactor that changes this
 * to "we tried" silently makes those records lie.
 *
 * When unconfigured this logs and reports `false` rather than throwing: a
 * missing email provider should not take down the flow that triggered it.
 */
export const withLovableEmail: Middleware<
  "email",
  WithLovableEmailConfig,
  Record<never, never>,
  LovableEmail
> = defineMiddleware<"email", WithLovableEmailConfig, Record<never, never>, LovableEmail>({
  key: "email",
  run: (config) => async () => {
    // Read per request, not at module load — Workers bindings are not ambient.
    const apiKey = getEnv(config.apiKeyEnv ?? "RESEND_API_KEY");
    const from = getEnv(config.senderEnv ?? "EMAIL_SENDER_ADDRESS");
    const enabled = Boolean(apiKey && from);

    const email: LovableEmail = {
      enabled,
      async send(mail) {
        if (!enabled) {
          console.info("[email] skipped (no sender domain configured):", mail.to, mail.subject);
          return false;
        }

        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              authorization: `Bearer ${apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              from,
              to: [mail.to],
              subject: mail.subject,
              html: config.render(mail),
            }),
          });
          if (!res.ok) {
            console.error("[email] delivery failed", res.status, await res.text());
            return false;
          }
          return true;
        } catch (error) {
          console.error("[email] delivery error", error);
          return false;
        }
      },
    };

    return { email };
  },
});
