-- Least-privilege ACLs for the existing owner-scoped client RPCs.
--
-- Supabase bootstraps `public` with
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
-- so every RPC created by a migration silently starts out executable by `anon`
-- and `service_role`. Earlier migrations only revoked `public, anon,
-- authenticated` before re-granting `authenticated`, which left the default
-- `service_role` grant in place on every owner-scoped RPC.
--
-- Two invariants are enforced here and asserted in
-- `supabase/tests/rpc_role_acl_contract.sql`:
--
--   1. No `public` RPC that reads `auth.uid()` may be executable by
--      `service_role`. The backend identity must never be able to act as a
--      user; it reaches user data only through the explicit worker RPCs.
--   2. `anon` keeps EXECUTE only on the documented pre-auth and public-catalog
--      surfaces: `is_username_available` (sign-up availability check),
--      `search_events` and `get_event_detail` (the user-independent event
--      catalog that the edge cache is allowed to serve).
--
-- Forward-only and ACL-only: no function body, signature, policy, row or
-- visible product behaviour changes. `authenticated` keeps every grant it
-- already had, so no existing screen or flow changes. Rolling back is a
-- forward migration that re-grants the listed roles.

begin;

revoke execute on function public.block_user(target_user_id uuid)
  from anon, service_role;
revoke execute on function public.change_event_like_to_pass(target_event_id uuid, target_user_id uuid, request_id uuid)
  from anon, service_role;
revoke execute on function public.complete_onboarding()
  from anon, service_role;
revoke execute on function public.delete_match_chat(target_match_id uuid, delete_mode text)
  from anon, service_role;
revoke execute on function public.end_match(target_match_id uuid)
  from anon, service_role;
revoke execute on function public.get_candidate_compatibilities(target_user_ids uuid[])
  from anon, service_role;
revoke execute on function public.get_chat_match_context(target_match_id uuid)
  from anon, service_role;
revoke execute on function public.get_event_candidates(target_event_id uuid, page_size integer, after_incoming boolean, after_joined_at timestamp with time zone, after_user_id uuid)
  from anon, service_role;
revoke execute on function public.get_event_card_states(target_external_ids bigint[])
  from anon, service_role;
revoke execute on function public.get_event_detail(target_event_id uuid)
  from service_role;
revoke execute on function public.get_incoming_event_likes(page_size integer, after_liked_at timestamp with time zone, after_user_id uuid)
  from anon, service_role;
revoke execute on function public.get_match_context(target_user_id uuid, target_match_id uuid)
  from anon, service_role;
revoke execute on function public.get_matching_like_counts()
  from anon, service_role;
revoke execute on function public.get_my_profile()
  from anon, service_role;
revoke execute on function public.get_outgoing_event_likes(page_size integer, after_liked_at timestamp with time zone, after_user_id uuid)
  from anon, service_role;
revoke execute on function public.get_profile_view(target_profile_id uuid)
  from anon, service_role;
revoke execute on function public.get_swipe_quota()
  from anon, service_role;
revoke execute on function public.is_username_available(candidate_username text)
  from service_role;
revoke execute on function public.join_event(target_event_id uuid)
  from anon, service_role;
revoke execute on function public.leave_event(target_event_id uuid)
  from anon, service_role;
revoke execute on function public.list_blocked_users()
  from anon, service_role;
revoke execute on function public.list_joined_events(include_left boolean, page_size integer, cursor_joined_at timestamp with time zone, cursor_event_id uuid)
  from anon, service_role;
revoke execute on function public.list_joined_rooms(page_size integer, cursor_joined_at timestamp with time zone, cursor_event_id uuid)
  from anon, service_role;
revoke execute on function public.list_matches(status_filter text, page_size integer, cursor_activity_at timestamp with time zone, cursor_match_id uuid)
  from anon, service_role;
revoke execute on function public.list_room_messages(target_event_id uuid, page_size integer, cursor_created_at timestamp with time zone, cursor_message_id uuid)
  from anon, service_role;
revoke execute on function public.list_saved_events(page_size integer, cursor_saved_at timestamp with time zone, cursor_event_id uuid)
  from anon, service_role;
revoke execute on function public.mark_match_read(target_match_id uuid)
  from anon, service_role;
revoke execute on function public.mark_room_read(target_event_id uuid)
  from anon, service_role;
revoke execute on function public.register_push_token(expo_token text, token_platform text, project_id uuid, app_version text)
  from anon, service_role;
revoke execute on function public.replace_profile_interests(interest_ids uuid[])
  from anon, service_role;
revoke execute on function public.replace_profile_photos(storage_paths text[])
  from anon, service_role;
revoke execute on function public.revoke_push_installation(client_installation_id uuid, app_environment text, expo_token text, revocation_reason text)
  from anon, service_role;
revoke execute on function public.search_events(search_text text, city_filter text, category_filter text, starts_after timestamp with time zone, starts_before timestamp with time zone, sort_by event_sort, page_size integer, cursor_sort_at timestamp with time zone, cursor_event_id uuid)
  from service_role;
revoke execute on function public.send_direct_message(target_match_id uuid, message_body text, client_message_id uuid)
  from anon, service_role;
revoke execute on function public.send_room_message(target_event_id uuid, message_body text, client_message_id uuid)
  from anon, service_role;
revoke execute on function public.set_match_filters(genders profile_gender[], minimum_age smallint, maximum_age smallint, interest_ids uuid[])
  from anon, service_role;
revoke execute on function public.set_matching_enabled(enabled boolean, target_event_id uuid)
  from anon, service_role;
revoke execute on function public.submit_report(target_user_id uuid, reason report_reason, details text, target_event_id uuid, target_match_id uuid, client_context jsonb, block_after boolean, client_request_id uuid)
  from anon, service_role;
revoke execute on function public.submit_room_report(target_event_id uuid, reason text, details text, client_request_id uuid)
  from anon, service_role;
revoke execute on function public.swipe_event_candidate(target_event_id uuid, target_user_id uuid, action swipe_action, request_id uuid)
  from anon, service_role;
revoke execute on function public.sync_push_installation(expo_token text, token_platform text, project_id uuid, client_installation_id uuid, app_environment text, app_version text, previous_expo_tokens text[])
  from anon, service_role;
revoke execute on function public.unblock_user(target_user_id uuid)
  from anon, service_role;
revoke execute on function public.unregister_push_token(expo_token text)
  from anon, service_role;

commit;
