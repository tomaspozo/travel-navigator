# Populate API audit logs for AI and email

## Changes
- Record every Lovable AI review gateway attempt in `api_call_logs`, including the endpoint, model, request category, outcome, and HTTP status where available.
- Record every Resend email delivery attempt, including provider endpoint, outcome, HTTP status, and whether delivery was skipped because email is not configured.
- Keep secrets, authorization headers, recipient addresses, message bodies, and AI prompt contents out of audit payloads.
- Ensure audit failures never interrupt AI validation or email delivery.

## Technical details
- Reuse the existing server-only `logApiCall` helper and its five-character non-reversible service-key fingerprint.
- Add logging on success, provider failure, rate/credit errors, configuration skips, and network exceptions.
- Verify the relevant server modules compile and that the audit inserts are reachable from both flows.
