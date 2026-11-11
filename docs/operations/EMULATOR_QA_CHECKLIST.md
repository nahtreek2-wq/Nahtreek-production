# Emulator QA checklist (internal APKs)

Manual pass for every internal release. Automated guest/login paths live in
`e2e/` (`run-all.sh`); this list covers what automation cannot judge:
visual coherence, motion feel, and hostile-network behavior.

## Setup

- Emulator: Pixel API 34, cold boot, host GPU on.
- Install: `adb install -r builds/android/<app>.apk` (uninstall first on
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` — signature rotation between trees).
- Backend: staging API unless the case says otherwise; confirm the in-app
  environment banner matches the intended backend.

## Home app

- [ ] Cold start: splash renders, no white flash, lands on Home or Login.
- [ ] Guest: browse discovery, open an engineer profile, fee shows in
  rupees (no 100x values, no raw paisa).
- [ ] Login (client-02): inbox, request detail, journey panel quote block.
- [ ] Quote approve: dialog amount matches the quote block; online vs
  pay-at-home copy correct.
- [ ] PaymentSection: button quotes the exact paisa amount (try ₹199.99
  staging fixture — must read ₹199.99, not ₹199 or ₹200).
- [ ] Razorpay sheet offers UPI + cards only; contact/email prefilled.
- [ ] After payment: screen never freezes; back/actions all work.
- [ ] Chat: send shows the bubble instantly; airplane-mode send restores
  the draft with the retry hint.
- [ ] AI Planner: free quota copy matches the server plan card (₹129);
  cancel ends Plus features at period end.
- [ ] Support: file a ticket, post a follow-up reply, thread renders.
- [ ] Deep links: `nahtreek://request/<id>`, `nahtreek://support` open the
  right screens from a cold start.
- [ ] Filters persist across restarts (discovery + requests).
- [ ] Reduced motion on: no entrance cascades, toasts appear statically.

## Pro app

- [ ] Cold start, login (pro preview account), inbox tagline rows render.
- [ ] Open a job: detail aligned, client avatar present, Plus pill correct.
- [ ] Quote send (₹ input) → client sees the same rupees; approve works.
- [ ] Travel card shows the client address; live tracking starts/stops.
- [ ] Collect payment: reconcile path — capture, then re-open (no double).
- [ ] Dues: order-first confirm; gateway amount equals the app amount.
- [ ] Membership purchase: no freeze after Razorpay returns.
- [ ] Support thread + notifications settings screens render.
- [ ] Icons: soft-tint chips everywhere, no legacy navy blocks.

## Hostile network (both apps)

- [ ] Airplane mode mid-chat: sends fail soft, drafts kept, no crash.
- [ ] 3G throttle on discovery: skeletons show, then content, no layout jump.
- [ ] Kill app mid-checkout, relaunch: watchdog recovers or shows
  Check status; never double-charges.
- [ ] Socket: background 60s, foreground — conversation rejoins, new
  messages arrive without a manual refresh.

## Release gate

- [ ] `scripts/check-bundle-budget.sh` passes.
- [ ] Full suites green: API, Home, Pro, Admin.
- [ ] Screenshots of changed surfaces attached to the release note.
