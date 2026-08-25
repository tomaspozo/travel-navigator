/**
 * Single integration point for outbound email.
 *
 * Managed email delivery requires a verified sender domain for the project.
 * Until one is configured, this logs the message server-side and reports that
 * it was not delivered, so notification records stay accurate.
 */
import { logApiCall } from "./api-audit.server";

export interface OutboundEmail {
  to: string;
  subject: string;
  heading: string;
  body: string;
  actionUrl?: string | undefined;
  actionLabel?: string | undefined;
}

export function emailEnabled(): boolean {
  return Boolean(process.env["EMAIL_SENDER_ADDRESS"] && process.env["RESEND_API_KEY"]);
}

export function renderEmailHtml(mail: OutboundEmail): string {
  const action = mail.actionUrl
    ? `<p style="margin:24px 0"><a href="${mail.actionUrl}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${mail.actionLabel ?? "Open request"}</a></p>`
    : "";
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin:0 0 8px">Voyara</p>
  <h1 style="font-size:20px;margin:0 0 12px">${mail.heading}</h1>
  <p style="font-size:15px;line-height:1.6;margin:0;white-space:pre-line">${mail.body}</p>
  ${action}
  <p style="font-size:12px;color:#94a3b8;margin-top:32px">You receive this because you are involved in this travel request.</p>
</div>`;
}

/** Returns true when the message was actually handed to a delivery provider. */
export async function deliverEmail(mail: OutboundEmail): Promise<boolean> {
  if (!emailEnabled()) {
    await logApiCall("email/send", {
      provider: "resend",
      outcome: "skipped_not_configured",
    });
    console.info("[email] skipped (no sender domain configured):", mail.to, mail.subject);
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env["RESEND_API_KEY"]}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env["EMAIL_SENDER_ADDRESS"],
        to: [mail.to],
        subject: mail.subject,
        html: renderEmailHtml(mail),
      }),
    });
    if (!res.ok) {
      await logApiCall("email/send", {
        provider: "resend",
        outcome: "provider_error",
        status: res.status,
      });
      console.error("[email] delivery failed", res.status, await res.text());
      return false;
    }
    await logApiCall("email/send", {
      provider: "resend",
      outcome: "success",
      status: res.status,
    });
    return true;
  } catch (error) {
    await logApiCall("email/send", {
      provider: "resend",
      outcome: "network_error",
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    console.error("[email] delivery error", error);
    return false;
  }
}
