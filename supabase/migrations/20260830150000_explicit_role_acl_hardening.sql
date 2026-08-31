-- Supabase/PostgREST may materialize default privileges as explicit role ACLs.
-- Revoking only PUBLIC therefore does not remove grants already held by anon or
-- authenticated. Keep the public API surface explicit and least-privileged.

revoke all privileges on table public.profiles from anon;

revoke all privileges on table public.direct_messages from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.direct_messages
  from authenticated;

revoke execute on function public.send_direct_message(uuid, text, uuid)
  from anon;
grant execute on function public.send_direct_message(uuid, text, uuid)
  to authenticated;

revoke execute on function public.claim_notification_event(uuid)
  from anon, authenticated;
revoke execute on function public.claim_notification_events(integer)
  from anon, authenticated;
revoke execute on function public.claim_pending_push_receipts(integer)
  from anon, authenticated;

grant execute on function public.claim_notification_event(uuid)
  to service_role;
grant execute on function public.claim_notification_events(integer)
  to service_role;
grant execute on function public.claim_pending_push_receipts(integer)
  to service_role;
