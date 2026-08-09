alter table public.moderation_reports
  drop constraint if exists moderation_reports_reporter_user_id_fkey,
  drop constraint if exists moderation_reports_target_user_id_fkey,
  drop constraint if exists moderation_no_self;

alter table public.moderation_reports
  alter column reporter_user_id drop not null,
  alter column target_user_id drop not null;

alter table public.moderation_reports
  add constraint moderation_reports_reporter_user_id_fkey foreign key (reporter_user_id) references public.profiles(id) on delete set null,
  add constraint moderation_reports_target_user_id_fkey foreign key (target_user_id) references public.profiles(id) on delete set null,
  add constraint moderation_no_self check (reporter_user_id is null or target_user_id is null or reporter_user_id <> target_user_id);

create or replace function private.realtime_match_id(topic text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when topic ~ '^match:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(topic, ':', 2)::uuid
    else null
  end
$$;

create policy "match members receive private realtime"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.matches m
    where m.id = private.realtime_match_id((select realtime.topic()))
      and (select auth.uid()) in (m.user1_id, m.user2_id)
  )
);

create policy "match members send private realtime"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.matches m
    where m.id = private.realtime_match_id((select realtime.topic()))
      and (select auth.uid()) in (m.user1_id, m.user2_id)
  )
);
