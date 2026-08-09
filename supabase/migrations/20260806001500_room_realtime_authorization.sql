begin;

create or replace function private.realtime_event_id(topic text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(topic, ':', 2)::uuid
    else null
  end
$$;

create policy "event attendees receive private room realtime"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.event_attendees a
    where a.event_id = private.realtime_event_id((select realtime.topic()))
      and a.user_id = (select auth.uid())
  )
);

create policy "event attendees send private room realtime"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1 from public.event_attendees a
    where a.event_id = private.realtime_event_id((select realtime.topic()))
      and a.user_id = (select auth.uid())
      and a.status = 'joined'
  )
);

commit;
