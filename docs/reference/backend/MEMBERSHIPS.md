# Pro Membership (Razorpay subscriptions)

₹399/month recurring billing that buys a free first job each month, 7%
commission after that (vs 10%), a ₹2,000 dues ceiling (vs ₹500),
discovery priority and the member badge. Code:
`apps/api/src/modules/memberships/`. Data model: `Membership`,
`MembershipEvent`, `ProfessionalProfile.memberPriority`.

## Lifecycle

1. Pro taps Subscribe → `POST /api/v1/memberships/subscribe` verifies the
   configured plan (₹39,900 paisa, INR, monthly) and creates a Razorpay
   subscription (120 cycles, UPI autopay).
2. Pro authorizes in Razorpay Checkout (subscription checkout in the pro app).
3. `POST /api/v1/memberships/confirm` re-fetches the subscription and applies
   `ACTIVE`; webhooks (`subscription.activated/charged`) confirm the same.
   Confirm waits out the first-charge lag (re-reads `created`/`pending` up
   to ~9s) and otherwise answers "still confirming — do not pay again" so
   the app polls instead of stranding the user; a `halted`/`cancelled`
   mandate answers "no money was taken, start a fresh checkout".
4. Access is effective while the paid period runs, including a
   cancelled-but-paid tail. `PAST_DUE` keeps the tail; `PAUSED`/`EXPIRED` lose
   perks immediately.
5. Cancel works in every state. Active rows cancel at period end (paid tail
   kept, notification sent). `PENDING` checkouts always clear locally —
   Razorpay itself refuses to cancel a mandate with no billing cycle, so a
   provider failure there is swallowed and the row resets to `NONE`. If the
   provider cancel throws for an active row, the server re-reads the mandate
   and syncs locally when Razorpay already ended it (dashboard cancel,
   retried tap) instead of failing the user.
6. Subscribe never orphans: a live checkout resumes on its short URL (no
   duplicate mandates) and an already-`active` mandate replays as-is; only
   dead (cancelled/completed/expired) mandates mint a fresh subscription.
   Demo AI rows keep the demo until the real mandate confirms.
6. `POST /api/v1/internal/memberships/reconcile` (cron secret) expires lapsed
   rows and heals `memberPriority` flags. Webhooks dedupe by Razorpay event
   id and ignore stale-subscription events.

## Commission and discovery tie-in

- `PaymentsService` charges members 0% on the month's first booking row and
  7% after, else 10%. The rate locks at order/declare time.
- The dues ceiling is member-aware (₹2,000 vs ₹500) in the dues view, both
  accept blocks, and the admin dues summary.
- `GET /memberships/me` reports `lifetimeSavingsPaisa` + `jobsAtMemberRate`
  so the app can prove the membership paid off.
- Both discoveries order members first (`memberPriority` desc, then rating);
  engineer cards expose `isMember`, service cards expose `memberPriority`.

## Endpoints

| Method | Route | Role |
| --- | --- | --- |
| GET | `/memberships/me` | SERVICE_PROVIDER, ENGINEER |
| POST | `/memberships/subscribe` | SERVICE_PROVIDER, ENGINEER |
| POST | `/memberships/confirm` | SERVICE_PROVIDER, ENGINEER |
| POST | `/memberships/cancel` | SERVICE_PROVIDER, ENGINEER |
| POST | `/internal/memberships/webhook` | signature (no JWT) |
| POST | `/internal/memberships/reconcile` | cron secret |
| GET | `/memberships/admin/summary` | ADMIN (counts + MRR) |
| GET | `/memberships/admin/list` | ADMIN (paginated rows) |

Admin console (`apps/admin-web` → Memberships view) renders member counts,
monthly recurring revenue, and the filterable subscription list (read-only —
memberships change only from the pro app or billing webhooks).

## Still manual

- Test plans created (`RAZORPAY_MEMBERSHIP_PLAN_ID` ₹399, `RAZORPAY_AI_PLAN_ID`
  ₹129); subscribe + cancel verified live, full checkout completion still
  needs a human tap.
- Register the webhook: set `RAZORPAY_WEBHOOK_SECRET` on the API project and
  add `POST /api/v1/internal/memberships/webhook` in the Razorpay dashboard
  (subscription events). Until then activation relies on confirm + app
  polling, and dashboard-side cancels only sync when the user taps cancel.
- Schedule the reconcile endpoint (daily) wherever cron/CI runs it.
- Live-mode rerun: subscribe → autopay → charged → cancel → expiry.

## Home Plus subscription (₹129/month, client-side)

Same engine, second product: Home users get 5 free AI chats, then chat,
project plans and photo uploads need the ₹129/month Plus subscription —
plus booking perks: express AI-plan booking (skips to providers with the
plan prefilled), priority home service (15-min scheduled accept, late
penalties protect the job), 2% off engineer consultations (up to ₹100),
a Plus badge professionals see on request lists and details, and a
`clientPlus` flag on the admin payment ledger so support reviews Plus
disputes first. Code lives next to Pro membership
(`MembershipsService` `ai*` methods, `AiBillingController` at
`/api/v1/ai-billing`, `isPlusClient`/`plusClientIds` in
`membership-reads.ts` for cycle-free reads). Data model: `AiSubscription`
(keyed by `userId`), `AiSubscriptionEvent`. Free quota counts `AiMessage`
rows of type `USER_TEXT`.

- `GET /ai-billing/me` → status + `freeUsed`/`freeQuota` for the quota pill.
- `POST /ai-billing/subscribe|confirm|cancel` mirror the Pro checkout; the
  client opens Razorpay Checkout with `subscription_id`, then confirms.
- Paywalled AI calls fail with 402 + `AI_SUBSCRIPTION_REQUIRED`; the Home app
  shows the paywall card instead of an error.
- The shared `internal/memberships` webhook also routes AI events (looked up by
  provider subscription id, then `notes.aiSubscriptionId`); reconcile expires
  lapsed AI rows too.
- Setup: create the ₹129/month plan in Razorpay and set `RAZORPAY_AI_PLAN_ID`.
