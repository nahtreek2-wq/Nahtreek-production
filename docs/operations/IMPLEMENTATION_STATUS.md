# Implementation and acceptance status — 25 September 2026

The preview Client and Professionals APKs, preview admin and preview API use the shared source under `apps/`. Production and preview configurations live under `deployments/`; production is not a separately maintained copy of the code.

## 25 September reliability, geography and notification update

## 25 September live service workflow update

- Preview migration `20260925110000_service_journey` is applied. It stores each
  service booking workflow, an idempotency key, recipient contact/consent,
  expiry, arrival estimate, quote approval, start code, completion/issue state
  and an optimistic revision. It also stores explicit provider presence with a
  timestamp, accuracy and coverage radius.
- New `service-workflow` endpoints enforce the Client/Professional action
  sequence. They prohibit skipped stages, duplicate submissions, stale edits,
  accepting a second active job, and using the legacy status endpoint for a
  workflow booking. They do not record payment or promise service completion
  in 30 minutes.
- ASAP matching uses verified availability, active-job exclusion, a recent
  accurate opt-in provider location and Geoapify driving ETA. Scheduled service
  uses the provider's base location. The address can belong to an approved
  recipient other than the account holder.
- The Professional Android app has a transparent, foreground service for live
  work location. It requires explicit precise-location permission and creates
  a persistent notification with a Stop action. It does not restart itself, and
  it stops when the user signs out. The Client receives provider coordinates
  only while its assigned booking is `EN_ROUTE`; old coordinates are marked
  stale.
- Preview cron replaces the named dispatch and booking-expiry jobs on setup.
  It sends durable FCM request changes immediately where possible and retries
  them from the existing worker. Empty/missing device tokens still leave the
  in-app inbox and three-second active-screen refresh as the fallback.
- API unit checks: 92 passed. Client: 56 passed. Professionals: 10 passed.
  Six isolated API/database journeys passed, including one full live-service
  flow. All three TypeScript checks, both internal Android builds and APK
  signature checks passed. Emulator installation could not be repeated because
  no emulator/device was running at that time.

- Client profile photos upload and save as soon as the user chooses them, with an explicit success or failure message. The preview API already stores the uploaded URL on the client profile. A previously selected-but-unsaved local preview cannot be recovered from a new APK; verify the affected account after its email address is provided.
- Non-Home mobile headers now show the NAHTREEK mark without repeating the name; the Client Profile header and map header follow the same treatment. Professional Home still shows the name. Notification icons now use semantic success/info/message colors; yellow remains for offers and brand actions.
- Client engineering and service request lists/details, plus Professional Home and request detail, refresh while the app is active. This complements push-triggered query invalidation but is not a measured real-time SLA.
- The Client map screen can open the existing interactive Android Geoapify view, with the static preview and external directions retained. The Geoapify static-map endpoint returned a valid image in a local diagnostic; a physical-device map check is still required.
- Client Messages now describes both engineers and service providers correctly, and its Browse Services action opens the services catalogue.
- Both apps now have searchable State/District pickers sharing a government directory snapshot (36 states/UTs, 787 districts, retrieved 25 September). Changing state clears the district. Existing city storage remains compatible; this is versioned reference metadata, not invented profile content.
- Notification preferences persist per account on the server. Optional weekly tips default off and are limited to 09:00–20:00 IST; updates/messages are independently controlled. The preview dispatcher checks pending work every minute and checks for tips hourly. Android tips use a separate lower-priority channel. No mass promotional send was performed.
- Client Home activity includes service bookings as well as engineer requests. Status colors reflect pending/info/success/error/neutral states. Professional profile labels follow actual roles. Missing engineer availability no longer renders `undefined`.
- All three TypeScript checks passed, with 56 Client tests, 10 Professionals tests and 89 API unit tests passing. The five isolated PostgreSQL/HTTP integration checks passed, including both professional types' verification, exact booking, chat, completion/history, profile photo persistence, preferences authorization and AI plan access control. The first booking runs exceeded the 90-second whole-test limit; instrumented reruns completed in approximately 95–96 seconds per journey with a 180-second total limit and unchanged 35-second per-request timeout. Delivery/storage are substituted in this test. Synthetic schemas/accounts were removed afterward.
- Both internal APKs built and passed APK signature verification. The preview API and fifteenth database migration are deployed; a health sample returned HTTP 200 in 1.07 seconds. Geoapify static-map and tile diagnostics returned valid images. Emulator internal-header checks passed after restarting Android system/launcher failures; a complete physical-device map/push/upgrade test remains outstanding. Kluster was unavailable, so no Kluster review is claimed.

Production Firebase, signing, separate infrastructure, credential rotation, load testing and full two-phone acceptance remain outstanding. The affected real Client account's photo still requires account-specific confirmation. API checks do not prove interactive map rendering on every device or background notification display. Do not describe this preview deployment as production-ready or issue-free.

## Latest UI and delivery update

- Client signup now sends credentials and consent only; empty onboarding fields previously failed DTO validation. Actionable validation errors are displayed instead of a generic message. Guest AI content scrolls and has explicit spacing.
- Professional headers respect top safe areas; home includes the official logo and puts Today at a glance first. Bottom tabs follow the client's rounded treatment. Secondary home icons use neutral backgrounds.
- Work photos can be titled, uploaded and removed from the public profile. API validates image type/size and ownership, caps each portfolio at 20 items, and returns stored photo URLs. Work photos use a public folder; verification documents remain private. Removing a portfolio entry removes its listing, not the underlying stored object; storage retention cleanup remains operational work.
- Public profile no longer uses a stock cover as personal work. Engineering labels come from the actual specialization relationship. Completed-job counts and ratings come from database values. Approved verification reads “Profile verified”; rejected proofs do not enable submission.
- Verification status listing no longer signs every document URL, avoiding unnecessary storage requests. A local timing sample was health 2.24s, catalogue 0.64s then 0.32s; this is not a production latency benchmark.
- Preview push is enabled with a Supabase/Vault-protected minute worker. The authorized test was accepted by Firebase on its first attempt. Actual display awaits the user's confirmation; promotional campaigns and deep links remain unimplemented.
- Latest APKs and checksums: [releases](../../releases/README.md). Shared source was updated; the separate production deployment was not configured or released.

## Earlier implementation pass

- AI chat sends bounded conversation history and plans include the conversation context. The backend validates every plan field used by the UI, sets a provider timeout and output limit, handles unavailable providers, and uses PostgreSQL rate limiting shared across API instances. A failed AI reply does not leave a duplicate user message on retry. Client AI requests allow enough time for the server timeout to finish.
- Android push registration, permission handling, a notification channel, generic alerts, token re-registration and query refresh are shared by both apps. Backend registrations are bound to authenticated sessions. A durable notification queue handles worker leases, retries and invalid tokens. Preview delivery is now enabled; production remains unconfigured.
- Admin document rejection removes a previously verified profile from client discovery. Document review and profile approval lock the professional row during the decision. Verified profiles cannot accidentally resubmit themselves, and rejected documents alone do not satisfy submission requirements.
- Professional sign-in restoration and token refresh no longer resurrect a session after sign-out. Responses for a different signed-in account are rejected.
- Corrected the deployment examples to use the AI environment variable names actually read by the backend.
- Updated the API to NestJS 11.2.6, Express 5 and bcrypt 6, and added a standalone API lockfile with `npm ci` for reproducible Vercel installs. The standalone API dependency audit reports zero known vulnerabilities at the time of this pass. This is not a security certification of the application.

## Verification and limits

Results from this pass: 78 backend unit tests, 47 Client tests, 8 Professionals tests, 5 Admin tests and 4 isolated HTTP/database journey tests passed (142 checks). API and both mobile TypeScript checks passed. Both internal Android APKs built and launched on the emulator. The journey also passed with the live Groq provider before the dependency upgrade; the full post-upgrade rerun used the guided AI fallback. The final deployed preview API returned HTTP 200 for database health and HTTP 401 for unauthenticated notifications and worker calls. All 14 database migrations are applied. No production deployment is claimed.

`node apps/api/scripts/test-journey.cjs` creates an isolated PostgreSQL schema, applies the schema, and exercises the real HTTP routes for client signup, engineer and service-provider signup, profile/photo persistence, verification document submission, admin approval, discovery visibility, targeted booking, messages, request completion, notifications, activity history, role restrictions and AI plan persistence. It removes that schema and all synthetic accounts afterward. It never inserts test users into the application schema.

The test substitutes email delivery and object storage; OTP generation/consumption, account creation, authorization and business/database logic remain real. The auth request throttle is disabled in this harness so a complete synthetic journey can run quickly; ordinary API validation and JWT/role guards remain enabled. Hosted AI can be included by explicitly supplying provider settings and `NAHTREEK_E2E_LIVE_AI=true`; otherwise it tests the guided fallback.

Unit tests, mobile TypeScript checks, Android builds and emulator launch checks complement this test. They do not prove physical-device push delivery, real document authenticity, live payment settlement or every screen interaction. Kluster was unavailable in this session; no Kluster verification is claimed.

## Still requires setup or a separate implementation

| Item | Status / next step |
| --- | --- |
| Android background push | Preview worker is scheduled and Firebase accepted a physical-device test. Complete two-phone display/tap/logout acceptance. Production Firebase remains unconfigured. See [setup](FIREBASE_PUSH_SETUP.md). |
| Credential rotation | Current provider credentials were not rotated in this pass. Replacement credentials must be generated in the owning provider accounts and deployed before old ones are revoked. See [rotation runbook](CREDENTIAL_ROTATION.md). |
| Production infrastructure | Separate production database, storage, domains, keys, signing and monitored deployment remain launch work; preview deployment does not prove production readiness. |
| Payments and payouts | Gateway orders, webhook reconciliation, refunds (with retry sweeper), receipts and professional settlements are implemented; live keys, Route activation and the refund-retry cron remain setup work. |
| Production account verification | Preview email OTP is separate from the unconfigured production SMS flow. |
| AI documents and voice | Upload records do not implement image interpretation, PDF extraction or voice assistance. |
| iOS push | APNs/Firebase iOS setup and native implementation are not included in the Android work. |
| Operational readiness | Mobile React Native/Metro/CLI dependency advisories remain; their framework upgrade requires native compatibility and APK regression testing. Backup restore drills, load tests and real-user usability testing are also release gates. The standalone API dependency audit is clean. |
| Full device acceptance | Repeat the booking and approval journey on two physical phones, including background notifications and poor connectivity. |
