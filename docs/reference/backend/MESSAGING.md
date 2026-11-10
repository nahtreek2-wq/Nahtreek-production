# Messaging

One conversation links to one engineer or service request in `PENDING`,
`ACCEPTED`, `IN_PROGRESS` or `COMPLETED` — both sides can clarify scope
before acceptance. `DRAFT`, `DECLINED` and `CANCELLED` requests stay silent.
The API verifies request state and both participant identities before
creating, joining, listing, reading, or sending. Sender identity is
authenticated server-side.

Messages persist in PostgreSQL before `message:created` is emitted to an authorized Socket.IO room. REST history is the reconnect recovery path. Attachments remain unavailable until signed object-storage uploads are implemented.
