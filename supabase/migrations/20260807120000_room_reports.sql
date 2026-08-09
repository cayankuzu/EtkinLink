create table if not exists public.room_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'unsafe', 'other')),
  details text not null check (char_length(trim(details)) between 20 and 1500),
  status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists room_reports_reporter_created_idx
  on public.room_reports (reporter_user_id, created_at desc);
create index if not exists room_reports_status_created_idx
  on public.room_reports (status, created_at);

alter table public.room_reports enable row level security;
revoke all on public.room_reports from public, anon, authenticated;

create or replace function public.submit_room_report(
  target_event_id uuid,
  reason text,
  details text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  if reason not in ('spam', 'harassment', 'unsafe', 'other') then
    raise exception 'invalid_reason';
  end if;
  if char_length(trim(details)) not between 20 and 1500 then
    raise exception 'invalid_details';
  end if;
  if not exists (
    select 1
    from public.event_attendees attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = auth.uid()
      and attendee.status = 'joined'
  ) then
    raise exception 'room_access_denied';
  end if;
  if (
    select count(*)
    from public.room_reports report
    where report.reporter_user_id = auth.uid()
      and report.created_at >= now() - interval '1 hour'
  ) >= 5 then
    raise exception 'report_rate_limited';
  end if;

  insert into public.room_reports (
    reporter_user_id,
    event_id,
    reason,
    details
  ) values (
    auth.uid(),
    target_event_id,
    reason,
    trim(details)
  )
  returning id into report_id;

  return report_id;
end;
$$;

revoke all on function public.submit_room_report(uuid, text, text) from public;
grant execute on function public.submit_room_report(uuid, text, text) to authenticated;
