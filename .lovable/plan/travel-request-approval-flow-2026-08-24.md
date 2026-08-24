# Travel Request Approval Flow

An internal tool where team members submit trip requests, the app checks them against role-based travel policies, and approvals move through two steps.

## Roles

- **Employee** — submits requests, sees their own.
- **Manager** — first approval step.
- **Finance/Executive** — second approval step for requests that are over policy or over a cost threshold.
- **Admin** — manages roles, policy limits, and who has which role.

Roles are stored separately from user profiles so they can't be self-assigned.

## Sign-in

Email + password accounts (Lovable Cloud). Signup collects full name and department; everyone starts as Employee until an admin assigns something else.

## Request form

- Destination (city/country), purpose/justification for the trip
- Departure and return dates (trip length is derived)
- Transportation: mode, estimated ticket price, whether booking help is needed
- Hotel: nightly rate, nights, whether booking help is needed
- Per diem requested (per day), plus other estimated costs
- Total estimated budget calculated live as the form is filled

## Policy engine

Each role has an editable policy record:

- Max trip length (days)
- Max ticket price (per leg/ticket)
- Max hotel nightly rate
- Max per diem per day
- Second-approval threshold (total cost above which finance review is required)

When the requester fills the form, each limit is checked live against their role's policy. Any breach shows an inline warning with the limit and the overage. Submission is allowed only once the requester writes an **exception justification** explaining each breach. Requests with breaches are marked "Policy exception" and always route to the second approval step.

## Approval flow

```text
Draft -> Submitted -> Manager review -> Finance review* -> Approved
                            |                  |
                         Rejected           Rejected
```

\*Finance review runs only when the request has a policy exception or exceeds the second-approval threshold; otherwise manager approval finalizes it.

Approvers can approve, reject with a reason, or send back for changes. Every action is recorded in an approval history timeline visible on the request.

## Screens

- `/auth` — sign in / sign up
- `/` — public landing with sign-in call to action
- `/dashboard` — my requests, status chips, "New request" button
- `/requests/new` — request form with live policy checks and budget total
- `/requests/$id` — full detail, policy breach panel, approval timeline, approver actions
- `/approvals` — queue of requests awaiting the signed-in user's approval step
- `/admin/policies` — create/edit roles and their limits
- `/admin/users` — assign roles to team members

## Technical notes

- Lovable Cloud for database, auth, and RLS.
- Tables: `profiles`, `app_role` enum + `user_roles`, `travel_policies` (one row per role, admin-editable), `travel_requests`, `request_approvals` (audit trail of each step).
- `has_role(user_id, role)` security-definer function; RLS: requesters read/write their own requests while in draft/submitted-for-changes; approvers read requests at their step; admins read all. Explicit GRANTs on every table.
- Policy evaluation runs in a shared module used by both the client form (live warnings) and an authenticated server function on submit, so limits can't be bypassed by editing the client.
- State transitions handled by authenticated server functions that verify the caller holds the right approver role for the current step.
- Zod validation on all inputs, client and server.
- Seed migration inserts starter policies for employee and executive so the admin screen isn't empty.
