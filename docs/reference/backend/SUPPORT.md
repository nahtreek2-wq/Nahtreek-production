# Human support tickets

Both apps say "support will review it" in several flows (mismatched
payments, disputes, stuck refunds). This module is the human behind that
sentence: users file tickets from Help (Home) or Help & support (Pro) and
track replies in the same place. An admin reply also lands as an in-app
`support` notification (`destination: 'support'`) so both apps deep-link
straight to the ticket list.

## Endpoints

| Method | Route | Role |
| --- | --- | --- |
| POST | `/support/tickets` | CLIENT, SERVICE_PROVIDER, ENGINEER |
| GET | `/support/tickets/me` | CLIENT, SERVICE_PROVIDER, ENGINEER (own only) |
| GET | `/support/admin/tickets` | ADMIN (`?status=OPEN|ANSWERED|RESOLVED`) |
| POST | `/support/admin/tickets/:id/reply` | ADMIN (marks ANSWERED + notifies) |
| POST | `/support/admin/tickets/:id/resolve` | ADMIN (marks RESOLVED) |

## Rules (enforced in code)

- Subject 4–120 chars, message 10–2000 chars, optional 40-char booking
  ref; whitespace floods are collapsed before storage.
- Users only ever read their own tickets; admins see contact details per
  row for follow-up.
- Every reply and resolve writes an audit log entry.
