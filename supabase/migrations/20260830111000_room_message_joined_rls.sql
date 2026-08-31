begin;

drop policy if exists room_messages_attendee_read on public.room_messages;
create policy room_messages_attendee_read
on public.room_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = room_messages.event_id
      and attendee.user_id = (select auth.uid())
      and attendee.status = 'joined'
  )
  and not private.is_blocked((select auth.uid()), sender_id)
);

drop policy if exists "event attendees receive private room realtime"
on realtime.messages;
create policy "event attendees receive private room realtime"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = private.realtime_event_id(
        (select realtime.topic())
      )
      and attendee.user_id = (select auth.uid())
      and attendee.status = 'joined'
  )
);

commit;
