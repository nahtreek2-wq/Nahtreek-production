# NAHTREEK Client product architecture and delivery gates

Status: implementation in progress, 14 September 2026. The existing Android reference APK is not evidence of production readiness. The shared React Native client and existing NestJS/PostgreSQL backend are the starting point. Engineer application changes are outside this client delivery.

## Screen inventory and journeys

| Area | Destinations | Required customer outcome |
| --- | --- | --- |
| Entry | Splash, login/register, OTP, expired session | Restore a secure session or verify a real phone number |
| Location | Manual search, recent locations, current location permission | Select an area even when GPS permission is denied |
| Home | Needs, recommendations, recent views, active request, saved shortcut | Find the next useful action |
| Discovery | Search, engineers, filters/sort, service catalogue, service detail | Match a requirement to a supported professional/service |
| Professional | Profile, portfolio, availability, reviews | Assess actual credentials, cost and availability |
| Request | Form, review/edit, confirmation, list, detail/timeline | Submit once, then track backend-controlled progress |
| Communication | Conversations, chat, notifications | Communicate using stable request and participant IDs |
| Account | Profile/edit, preferences, saved items, support, legal/about, logout | Manage personal information and exit safely |
| Completion | Eligible review form and submission result | Review only one's completed interaction |

Primary journey: restore/login → choose location → Home → discovery → professional → request form → review → server confirmation → request detail → conversation → completion → eligible review.

Guest journey: Home → discovery → professional → authentication before any account mutation. Authentication must preserve the intended destination. Offline journey: cached reads → clear stale/offline indication → block server mutations → refresh active stale queries on reconnect.

## Navigation decision

Retain five tabs: Home, Engineers, Requests, Messages, Profile. Detail, search, service, request composer and settings routes belong to the root stack; filters and simple selections use sheets. Notification/deep-link targets contain stable IDs and must pass authentication and server authorization before opening private data. A back action returns to the initiating screen. Route types are shared by both platforms.

## Domain and API decisions

Keep the existing NestJS modular monolith and Prisma/PostgreSQL authority. Existing entities include User, Session, ClientProfile, ProfessionalProfile, EngineerProfile, Specialization, AvailabilitySlot, ServiceArea, PortfolioItem, EngineerRequest, RequestStatusHistory, Favorite, Conversation, ConversationParticipant, Message, Notification and Review. Audit existing relations and uniqueness constraints before migrations. Add service definitions, file metadata and device registrations only through reviewed migrations where existing entities cannot serve them.

Use the existing versioned contracts (`/api/v1/auth`, `/clients/me`, `/discovery/engineers`, `/engineer-requests`, `/favorites`, `/conversations`, `/notifications`). Add missing service/location/file endpoints consistently; do not rename working routes merely to match examples in the brief. Every list needs bounded pagination. Every private lookup checks the authenticated actor's relation to the resource. Request transitions and history timestamps are written transactionally on the server. Review eligibility and uniqueness are server-enforced. Request/message submission requires idempotency and duplicate-tap guards.

## Design system

Use shared NAHTREEK tokens: navy #111F35, deep navy #111F35, construction yellow #C4A639, pressed yellow #C4A639, soft yellow #FFF4D8, light #F7F9FC, text #172033 and secondary text #667085. Yellow is reserved for primary actions, active navigation, progress and highlights; body copy stays navy/slate for readable contrast. Shared buttons, inputs, sheets and states use consistent spacing and at least 44-point touch targets. Avoid fixed content heights for scalable text. Respect reduced motion and screen readers. Real backend verification, ratings and availability are the only basis for trust labels. Service categories must open relevant service information/results.

## Authentication and security

Use existing server OTP authentication, short-lived access tokens and rotating refresh sessions; verify rotation and reuse rejection in integration tests. Android stores session data encrypted with Keystore; iOS requires Keychain. Serialize session writes/clears, clear account-scoped caches on logout, and handle unavailable protected storage without silently claiming persistence. Never place tokens in AsyncStorage or logs. Authenticated API requests share one refresh attempt and cannot revive a logged-out session. Files require ownership, size/type checks and private object storage access.

## Cache and offline policy

| Data | Target freshness | Persistence and recovery |
| --- | --- | --- |
| Service definitions | 24 hours | Versioned public cache |
| Search/professional details | 1–5 minutes | Bounded public cache; refresh visible stale results |
| Requests/notifications | 15–30 seconds | Account-scoped protected cache; mark stale |
| Messages | 15 seconds plus socket events | Bounded account-scoped history, reconcile IDs |
| Profile | 5 minutes | Protected account-scoped cache |

These are target rules, not a claim that persistent caching is implemented. Offline writes are blocked for now; no implicit queue. Fixture data must never replace failed live reads or enter distribution builds. Empty arrays preserve safe list rendering; missing detail data stays absent and produces a not-found/error state.

## Messaging and notifications

Persist messages by conversation/request/client/professional IDs. REST pagination supplies history; socket events invalidate/reconcile using message IDs. Reconnect and foreground refresh missed events, remove listeners on cleanup, and suppress duplicates. Delivery labels reflect server evidence. Persist notification read state. Device registration, FCM/APNs delivery and destination routing require real provider configuration; local preference switches alone do not implement push delivery.

## Errors, observability and testing

Map timeout, offline, permission, auth, validation and server failures to useful customer language. Keep raw diagnostics out of screens. Retry reads with bounded backoff; do not automatically repeat non-idempotent writes. Prepare redacted crash reporting and non-sensitive analytics only with configured providers.

Gate each phase with relevant unit/component/integration checks and customer-flow tests. Include expired tokens, offline/server failure, duplicate submission, denied permissions, missing images, large text and background/resume. Verify persistence against PostgreSQL across a server restart. Test small/standard/large Android and iPhone sizes; JS mocks cannot certify native secure storage or device behavior.

## Delivery order and release gates

1. Architecture, screen inventory, contracts and domain audit.
2. Native configuration, secure storage, authentication and cache isolation.
3. Location, discovery, profiles and service journeys.
4. Persistent favorites and request review/confirmation/tracking.
5. Messaging, notification routing, reviews and account management.
6. Offline recovery, accessibility, performance and security tests.
7. Android signed AAB/internal APK and iOS signed archive/TestFlight verification.

Known blockers: Xcode and an iOS simulator are absent on this Mac. Production API, push/storage provider configuration and release signing must be verified before distribution. Do not claim iOS validation, production signing or complete commercial readiness from the existing debug-signed Android APK. Automated Kluster review is unavailable in this session.
