# Payments (Razorpay commission engine)

Clients pay the approved quote in-app; the platform keeps a 10% commission and
the professional share releases when the client confirms completion. Code:
`apps/api/src/modules/payments/`. Data model: `Payment`, `PaymentEvent`,
`PayoutAccount` in `apps/api/prisma/schema.prisma`.

## Money flow

1. Professional sends QUOTE → client taps APPROVE_QUOTE (service-workflow).
2. Client app calls `POST /api/v1/payments/orders` → server creates a Razorpay
   order for the quote (integer paisa) and a `Payment` row (`ORDER_CREATED`).
3. Client pays via Razorpay Checkout (UPI/cards — card data never touches us).
4. Client app calls `POST /api/v1/payments/verify` with the Razorpay signature.
   The server verifies the HMAC, re-fetches the payment from Razorpay (source
   of truth, must be `captured` for the exact amount), marks `PAID`, and tries
   a Route on-hold transfer (`HELD`) when the pro has an ACTIVE payout account.
5. Work starts (`START` requires a paid payment while Razorpay is configured).
6. Client taps CONFIRM → server releases the hold / creates the transfer
   (`RELEASED`). Failures park at `RELEASE_PENDING` for admin retry, never
   silently.
7. CANCEL before completion auto-refunds (`REFUND_PENDING` → `REFUNDED` via
   webhook). ISSUE marks the payment `DISPUTED`; admin resolves to release or
   refund. Paid rows are never reset by a re-quote.

## Engineer (consultation) payments

Engineer bookings have no quote-approval flow, so the amount is the
engineer's consultation fee and the window differs: payment opens when the
engineer accepts and stays open through COMPLETED, since consultations are
usually settled once the visit or advice is delivered. PENDING cannot pay;
CANCELLED/DECLINED can never pay. Everything else mirrors the service flow —
same held-payment lifecycle, same commission split (10%, 7% for Pro
members), same idempotent verify/refund/release/dispute/webhook handling.

- `POST /payments/orders` and `POST /payments/verify` accept
  `engineerRequestId` instead of `serviceRequestId` (exactly one per call).
- `GET /payments/engineer-requests/:id` shows the payment to the client, the
  engineer, or an admin.
- Cancelling an engineer request voids unpaid orders and refunds captured
  fees automatically. Completing one notifies the client that the fee is now
  payable in the request.
- Engineers without a consultation fee set cannot be paid online; the client
  agrees the fee in chat instead.

## Collection model (who holds the money)

Two rails, one ledger. This is the standard Indian home-services setup
(Urban Company runs the same shape: platform-collected online payments plus
a dues/wallet debit for cash jobs).

ONLINE (default, recommended). The client pays in the app. Razorpay (an
RBI-authorised payment aggregator) collects into the platform account, the
pro share is held via a Route transfer, and completion/confirmation releases
it to the pro's Linked Account minus commission. The client never pays the
pro directly, and the pro never handles the platform's cut — the split
happens inside Razorpay. Requires: live Razorpay keys, Route enabled, and
each pro onboarded with a Linked Account + KYC.

AT-HOME (cash/UPI to the pro). The pro keeps the full collected amount in
their pocket; nothing reaches the platform account. The commission instead
posts to the pro's dues ledger (`COLLECTED_UNSETTLED`), and the pro settles
dues with in-app UPI. Accepting new work is blocked while dues exceed the
cap, for service and engineer bookings alike — so the platform % is
enforced by supply cutoff, not by chasing cash.

COMMISSION. 10% standard; active Pro members pay 7% after a free first
job each calendar month (0% on the month's first booking row, any status
counts so concurrent first jobs cannot both go free). Industry benchmark
is ~20-30% (Urban Company ~28%); the lower rate is a deliberate
win-supply-first position with room to raise later.

PLUS DISCOUNT. Plus clients pay 2% less (capped at ₹100) on engineer
consultations, funded from the platform fee — the engineer's share never
shrinks. Locks at order creation; at-home declares are unaffected.

SLA PENALTIES. Plus bookings carry teeth: ignoring one while online posts
₹25, arriving past target + 15 min grace posts ₹50. Penalties land in the
same dues the pro settles, count toward the dues ceiling, and settle with
the same order. Idempotent per booking+reason.

DUES CEILING. New accepts pause while unsettled commission reaches the
ceiling: ₹500 standard, ₹2,000 for members with a running paid period
(`duesLimitPaisa`, enforced identically in the dues view, both accept
paths, and the admin summary).

TEST MODE LIVE (2026-11-09). Test keys + both plans installed on the
preview API; end-to-end order → test-netbanking checkout → verify → PAID
proven in-app. Receipts send via Gmail SMTP (creds live).
STILL NEEDED. Live Razorpay keys + Route + Linked-Account onboarding, and CA
sign-off on GST-on-commission and TDS treatment before real money flows.

## Webhooks

`POST /api/v1/internal/payments/webhook` verifies `x-razorpay-signature`
against the raw body, dedupes by Razorpay event id (`PaymentEvent`), and
applies status-guarded transitions (`payment.captured`, `payment.failed`,
`refund.processed`, `refund.failed`). Unknown entities are acknowledged and
ignored; captures on superseded orders are adopted only on exact amount match,
else disputed for support.

## Refund retries

A failed `createRefund` call or a `refund.failed` event leaves the row in
`REFUND_PENDING` — never reverted to `PAID`, which would strand the money
with no retry path. Two mechanisms finish it:

- `POST /payments/refund` while `REFUND_PENDING` reconciles with Razorpay:
  adopts processed remote refunds, waits on live pending ones, recreates
  missing/failed ones (fetch-then-create, so no double refund).
- `POST /api/v1/internal/payments/retry-refunds` (cron secret, every
  15 minutes) sweeps `REFUND_PENDING` rows older than 10 minutes with the
  same reconcile. One poisoned row never blocks the rest.

Both paths send the client a refund receipt email on completion.

## Endpoints

| Method | Route | Role |
| --- | --- | --- |
| POST | `/payments/orders` | CLIENT |
| POST | `/payments/verify` | CLIENT |
| GET | `/payments/requests/:serviceRequestId` | CLIENT, SERVICE_PROVIDER, ADMIN |
| GET | `/payments/engineer-requests/:engineerRequestId` | CLIENT, ENGINEER, ADMIN |
| POST | `/payments/refund` | CLIENT, ADMIN |
| POST | `/payments/release` | ADMIN (retry) |
| POST | `/payments/resolve` | ADMIN (release/refund) |
| POST | `/payments/payout-accounts` | ADMIN (link Route account) |
| GET | `/payments/admin/summary` | ADMIN (ledger by status) |
| GET | `/payments/admin/list` | ADMIN (paginated ledger rows) |
| POST | `/internal/payments/webhook` | signature (no JWT) |
| POST | `/internal/payments/retry-refunds` | cron secret (every 15 min) |

Admin console (`apps/admin-web` → Payments view) renders the summary cards,
the filterable ledger, and per-payment actions: retry release, full refund,
and dispute resolution with audit notes.

## Money-safety rules (enforced in code)

- Atomic `updateMany` claims on verify, refund and release: concurrent
  double-submits converge on one winner, never a double charge or payout.
- The Route hold runs under a `FOR UPDATE` row lock: exactly one hold exists.
- `START` rechecks payment inside the booking transaction: a refund racing
  the start cannot let unpaid work begin.
- Closed bookings cannot be paid; late captures auto-refund or dispute.
- Key-mode fail-fast at boot: test keys in production or live keys in
  preview/development refuse to start, so a deploy can never charge the
  wrong money mode.

## Client checkout UI

`packages/mobile-booking/PaymentSection.tsx` (rendered in `JourneyPanel` for
approved quotes, and in the client RequestDetail screen for consultation
fees) runs order → Razorpay Checkout → verify, with state views
for unpaid/held/releasing/released/refund/dispute. The native SDK
(`react-native-razorpay`, client app only) loads lazily via
`razorpayGateway.ts`; builds without it show "not available" instead of
crashing. Cancellation is neutral; 503 maps to a "payments opening soon" note.
While unpaid, clients without an account email are offered a receipt-email
field; a bad address blocks the tap, a failed save warns but never blocks
the payment, and the email persists to the client profile.

## Receipt emails

Every completed payment emails a receipt: online verifies (service +
engineer), at-home declarations (both flows), and dues settlements (to the
pro). `EmailProvider` (`notifications/email.provider.ts`) is a Resend REST
client (needs `RESEND_API_KEY` + `EMAIL_FROM`); receipts are best-effort —
skipped when unconfigured or address-less, and a send failure never fails
the payment.

## Still manual / next builds

- Razorpay test keys + webhook secret on the server; Route activated. Then a
  test-mode end-to-end run and settlement reconciliation vs Razorpay reports.
- Pro payout onboarding (create/link Route linked accounts; today only admin
  linking exists, no KYC flow).
- iOS `pod install` for the Razorpay SDK before an iOS build.
