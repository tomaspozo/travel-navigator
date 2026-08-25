import type { OutboundEmail } from "@/lib/lovable-middleware/with-lovable-email";

export type { OutboundEmail };

/**
 * The Voyara email template.
 *
 * Delivery moved to `withLovableEmail` (provider, API key, sender address,
 * the disabled-path behaviour). What stays here is the part that is this
 * product's rather than the platform's: wording and branding. The middleware
 * takes this function as its `render` config.
 */
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
