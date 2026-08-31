# Moderation operations without an admin panel

## Product boundary

No moderator/admin/organizer UI is added. Users keep the existing report/block flows. Current server contracts include `submit_room_report` and moderation report storage with RLS; report details and reporter/target identity are sensitive and must not appear in email, alerts or ordinary logs.

## Intake and triage

1. User submission is authenticated, membership/visibility checked, server validated, rate limited and bound to a stable `client_request_id`; duplicate reports do not create duplicate enforcement.
2. Alert payload contains only report ID, coarse reason category, created time and severity routing key. Operators fetch details only through an audited service-role session.
3. The on-call assigns owner and SLA metadata, verifies target visibility/ownership, then records `reviewing`, `resolved` or `dismissed` using a restricted server-side operation.
4. Block effects are checked in feed/search/profile/match/DM/room/notification paths. Enforcement never trusts a client-provided moderator flag.
5. Appeal/reopen retains an append-only audit event; report body is not copied into the audit log.

## Repository operational control

`moderation_case_transition` is service-role-only and accepts a case ID, one allowed operation (`start_review`, `resolve`, `dismiss`, `appeal`, `reopen`), owner reference, policy code, actor ticket, stable request ID and bounded sanction code. It rejects invalid transitions and parameter mismatches, returns an immutable audit-event ID and never accepts arbitrary SQL. `get_moderation_case` is the service-role-only, parameterized read path. Direct production table edits remain prohibited.

Local pgTAP covers least privilege, visibility/relationship validation, bounded client context, rate limit, duplicate idempotency, real concurrent advisory locking, transitions, sanctions, appeal/reopen and immutable audit. This is repository evidence only: the RPCs must still be deployed to isolated staging and exercised through an approved least-privilege operator identity with two-person review before production-scale moderation is GO.

## Emergency safety

For imminent harm, follow `security-incident-response.md`; preserve evidence with restricted access and use existing block/account controls. Do not email raw report/profile/message data. Any temporary service-role operation requires two-person review, transaction log, incident ID and immediate credential revocation after use.
