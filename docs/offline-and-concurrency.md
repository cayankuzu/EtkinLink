# Offline and concurrency contract

## Persisted state boundaries

| State               | Scope/version                                     | Lifetime                      | Must not persist                                        | Purge                                |
| ------------------- | ------------------------------------------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------------ |
| React Query cache   | authenticated owner                               | configured query TTL          | another owner's rows/tokens                             | every session loss/logout            |
| event feed snapshot | viewer ID + normalized filters, schema v2         | 24 hours                      | signed attendee URLs, `joined`, `saved` personalization | invalid schema/TTL/viewer and logout |
| chat outbox         | `ownerId`, room/direct context, client message ID | bounded by centralized limits | access tokens or another owner                          | logout/session loss/account deletion |
| private images      | memory-only signed URL handling                   | URL expiry/session            | stable token-stripped disk cache                        | session loss/process memory release  |
| Realtime            | authorized topic membership                       | active session                | channel after block/leave/logout                        | remove all channels on session loss  |

Offline data is a resilience aid, not a second source of truth. Supabase/PostgreSQL and its RLS/RPC invariants remain authoritative.

## Mutation rules

- Optimistic writes snapshot the exact affected queries and restore them on error; invalidation alone is not rollback.
- A retryable offline chat mutation uses the same UUID `client_message_id` for every replay. Server idempotency determines success.
- Automatic mutation retry is forbidden unless the server contract has an idempotency key.
- Replay is owner-scoped and single-flight. Authentication loss, block, room leave, account delete or local logout cancels/purges pending work.
- 401 triggers only the shared single-flight refresh path; validation, conflict, authorization and abort errors do not fall back to another provider.
- Retry uses bounded backoff/jitter and honors `Retry-After`. Technical stack traces, tokens, message bodies, private URLs and user identifiers are not persisted in error telemetry or shown to users.

The current outbox stores attempt and next-attempt time and has age/size limits. A distinct durable dead-letter state and explicit cancel UI are not proven; this remains a reliability gap and must not be reported as complete until implemented and tested within the existing error/progress surface.

## Required deterministic scenarios

1. Duplicate tap: two requests with one idempotency key produce one domain row/message.
2. Two devices: concurrent join/leave/like/message respects the database invariant and returns success/conflict deterministically.
3. Optimistic + Realtime: echoed server row dedupes by stable ID; rollback never deletes a newer server result.
4. Process kill: enqueue, kill, relaunch, authenticate same owner, replay once; repeat after 24 hours/expiry.
5. User switch: owner A logs out with data queued; owner B sees neither A's snapshot nor outbox and cannot replay it.
6. Authorization revocation: block/leave/logout during inflight request prevents subsequent cache write/replay/subscription.
7. Corrupt storage: invalid snapshot/outbox is deleted or recovered from bounded backup without crashing.
8. Network transition: offline → captive/429/5xx → online respects retry schedule and never storms the origin.

Evidence includes test command/output, timestamps, owner IDs replaced with stable test aliases, request/client IDs, server row count and exact commit SHA. Unit/mock and Docker contract results are necessary but do not replace same-SHA two-device staging evidence; until it is attached, the concurrency/offline runtime gate remains `NO-GO`.
