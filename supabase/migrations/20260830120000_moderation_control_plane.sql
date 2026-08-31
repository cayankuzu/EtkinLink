begin;

alter table public.moderation_reports
  add column if not exists client_request_id uuid;
update public.moderation_reports
set client_request_id = gen_random_uuid()
where client_request_id is null;
alter table public.moderation_reports
  alter column client_request_id set default gen_random_uuid(),
  alter column client_request_id set not null;
create unique index if not exists moderation_reports_request_id_idx
  on public.moderation_reports (reporter_user_id, client_request_id);

alter table public.room_reports
  add column if not exists client_request_id uuid;
update public.room_reports
set client_request_id = gen_random_uuid()
where client_request_id is null;
alter table public.room_reports
  alter column client_request_id set default gen_random_uuid(),
  alter column client_request_id set not null;
create unique index if not exists room_reports_request_id_idx
  on public.room_reports (reporter_user_id, client_request_id);

update public.moderation_reports
set client_context = '{}'::jsonb
where jsonb_typeof(client_context) <> 'object'
  or octet_length(client_context::text) > 1024;

alter table public.moderation_reports
  drop constraint if exists moderation_client_context_shape,
  add constraint moderation_client_context_shape check (
    jsonb_typeof(client_context) = 'object'
    and octet_length(client_context::text) <= 1024
  );

create table private.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_report_id uuid not null,
  state text not null default 'pending',
  severity text not null,
  assigned_owner text,
  sla_due_at timestamptz not null,
  policy_code text,
  sanction_code text not null default 'none',
  appeal_count integer not null default 0,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint moderation_cases_source_kind_check
    check (source_kind in ('user_report', 'room_report')),
  constraint moderation_cases_source_unique
    unique (source_kind, source_report_id),
  constraint moderation_cases_state_check
    check (state in ('pending', 'reviewing', 'resolved', 'dismissed', 'appealed')),
  constraint moderation_cases_severity_check
    check (severity in ('standard', 'high', 'critical')),
  constraint moderation_cases_owner_format check (
    assigned_owner is null
    or assigned_owner ~ '^[A-Za-z0-9._@:-]{3,80}$'
  ),
  constraint moderation_cases_policy_format check (
    policy_code is null
    or policy_code ~ '^[A-Z0-9_.-]{2,64}$'
  ),
  constraint moderation_cases_sanction_check check (
    sanction_code in (
      'none',
      'warning',
      'temporary_restriction',
      'account_disable_recommendation'
    )
    and (sanction_code = 'none' or state = 'resolved')
  ),
  constraint moderation_cases_owner_state_check check (
    state = 'pending'
    or (assigned_owner is not null and policy_code is not null)
  ),
  constraint moderation_cases_resolution_check check (
    (state in ('resolved', 'dismissed') and resolved_at is not null)
    or (state not in ('resolved', 'dismissed') and resolved_at is null)
  ),
  constraint moderation_cases_appeal_count_check check (appeal_count >= 0),
  constraint moderation_cases_sla_check check (sla_due_at >= created_at)
);

create index moderation_cases_queue_idx
  on private.moderation_cases (state, sla_due_at, created_at, id);

create table private.moderation_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.moderation_cases(id) on delete restrict,
  event_type text not null,
  from_state text,
  to_state text not null,
  owner_ref text,
  policy_code text not null,
  sanction_code text not null default 'none',
  actor_ticket text not null,
  client_request_id uuid not null,
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint moderation_audit_request_unique unique (case_id, client_request_id),
  constraint moderation_audit_event_type_check check (
    event_type in ('submitted', 'start_review', 'resolve', 'dismiss', 'appeal', 'reopen')
  ),
  constraint moderation_audit_from_state_check check (
    from_state is null
    or from_state in ('pending', 'reviewing', 'resolved', 'dismissed', 'appealed')
  ),
  constraint moderation_audit_to_state_check check (
    to_state in ('pending', 'reviewing', 'resolved', 'dismissed', 'appealed')
  ),
  constraint moderation_audit_owner_format check (
    owner_ref is null
    or owner_ref ~ '^[A-Za-z0-9._@:-]{3,80}$'
  ),
  constraint moderation_audit_policy_format check (
    policy_code ~ '^[A-Z0-9_.-]{2,64}$'
  ),
  constraint moderation_audit_sanction_check check (
    sanction_code in (
      'none',
      'warning',
      'temporary_restriction',
      'account_disable_recommendation'
    )
  ),
  constraint moderation_audit_actor_ticket_format check (
    actor_ticket ~ '^[A-Za-z0-9._:/-]{3,120}$'
  ),
  constraint moderation_audit_payload_hash_check check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint moderation_audit_submission_shape check (
    (
      event_type = 'submitted'
      and from_state is null
      and to_state = 'pending'
      and owner_ref is null
    )
    or (
      event_type <> 'submitted'
      and from_state is not null
      and owner_ref is not null
    )
  )
);

create index moderation_audit_case_created_idx
  on private.moderation_audit_events (case_id, created_at, id);

alter table private.moderation_cases enable row level security;
alter table private.moderation_audit_events enable row level security;
revoke all on table private.moderation_cases
  from public, anon, authenticated, service_role;
revoke all on table private.moderation_audit_events
  from public, anon, authenticated, service_role;

create or replace function private.moderation_severity(report_reason text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when report_reason in ('underage', 'unsafe') then 'critical'
    when report_reason in ('harassment', 'hate_speech', 'nudity') then 'high'
    else 'standard'
  end
$$;

create or replace function private.validate_report_client_context(value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized jsonb := coalesce(value, '{}'::jsonb);
begin
  if jsonb_typeof(normalized) <> 'object'
    or octet_length(normalized::text) > 1024 then
    raise exception using
      errcode = '22023',
      message = 'Rapor istemci bağlamı geçersiz.';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(normalized) as context_key(key)
    where context_key.key not in ('platform', 'source', 'app_version', 'screen')
  ) then
    raise exception using
      errcode = '22023',
      message = 'Rapor istemci bağlamı desteklenmeyen alan içeriyor.';
  end if;

  if normalized ? 'platform' and (
    jsonb_typeof(normalized -> 'platform') <> 'string'
    or normalized ->> 'platform' not in ('android', 'ios', 'web')
  ) then
    raise exception using
      errcode = '22023',
      message = 'Rapor platform alanı geçersiz.';
  end if;

  if normalized ? 'source' and (
    jsonb_typeof(normalized -> 'source') <> 'string'
    or normalized ->> 'source' not in ('profile_photo', 'direct_chat', 'public_profile')
  ) then
    raise exception using
      errcode = '22023',
      message = 'Rapor kaynak alanı geçersiz.';
  end if;

  if normalized ? 'app_version' and (
    jsonb_typeof(normalized -> 'app_version') <> 'string'
    or char_length(normalized ->> 'app_version') not between 1 and 32
    or normalized ->> 'app_version' !~ '^[A-Za-z0-9._+-]+$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Rapor uygulama sürümü alanı geçersiz.';
  end if;

  if normalized ? 'screen' and (
    jsonb_typeof(normalized -> 'screen') <> 'string'
    or char_length(normalized ->> 'screen') not between 1 and 64
    or normalized ->> 'screen' !~ '^[A-Za-z0-9_.-]+$'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Rapor ekran alanı geçersiz.';
  end if;

  return normalized;
end;
$$;

create or replace function private.reject_moderation_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Moderation audit events are append-only.';
end;
$$;

create trigger moderation_audit_events_no_update_delete
before update or delete on private.moderation_audit_events
for each row execute function private.reject_moderation_audit_mutation();

create trigger moderation_audit_events_no_truncate
before truncate on private.moderation_audit_events
for each statement execute function private.reject_moderation_audit_mutation();

create or replace function private.create_moderation_case_from_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_kind text;
  report_severity text;
  target_case_id uuid;
  request_hash text;
begin
  report_kind := case
    when tg_table_name = 'moderation_reports' then 'user_report'
    else 'room_report'
  end;
  report_severity := private.moderation_severity(new.reason::text);

  insert into private.moderation_cases (
    source_kind,
    source_report_id,
    severity,
    sla_due_at,
    created_at,
    updated_at
  ) values (
    report_kind,
    new.id,
    report_severity,
    new.created_at + case report_severity
      when 'critical' then interval '4 hours'
      when 'high' then interval '12 hours'
      else interval '24 hours'
    end,
    new.created_at,
    new.created_at
  )
  on conflict (source_kind, source_report_id) do nothing
  returning id into target_case_id;

  if target_case_id is null then
    select moderation_case.id into target_case_id
    from private.moderation_cases as moderation_case
    where moderation_case.source_kind = report_kind
      and moderation_case.source_report_id = new.id;
  end if;

  request_hash := encode(
    extensions.digest(
      report_kind || ':' || new.id::text || ':' || new.client_request_id::text,
      'sha256'
    ),
    'hex'
  );

  insert into private.moderation_audit_events (
    case_id,
    event_type,
    from_state,
    to_state,
    owner_ref,
    policy_code,
    sanction_code,
    actor_ticket,
    client_request_id,
    payload_hash,
    created_at
  ) values (
    target_case_id,
    'submitted',
    null,
    'pending',
    null,
    'INTAKE',
    'none',
    'USER_SUBMISSION',
    new.client_request_id,
    request_hash,
    new.created_at
  )
  on conflict (case_id, client_request_id) do nothing;

  return new;
end;
$$;

insert into private.moderation_cases (
  source_kind,
  source_report_id,
  state,
  severity,
  assigned_owner,
  sla_due_at,
  policy_code,
  resolved_at,
  created_at,
  updated_at
)
select
  'user_report',
  report.id,
  case report.status::text
    when 'reviewing' then 'reviewing'
    when 'resolved' then 'resolved'
    when 'rejected' then 'dismissed'
    else 'pending'
  end,
  private.moderation_severity(report.reason::text),
  case when report.status::text = 'pending' then null else 'legacy-import' end,
  report.created_at + case private.moderation_severity(report.reason::text)
    when 'critical' then interval '4 hours'
    when 'high' then interval '12 hours'
    else interval '24 hours'
  end,
  case when report.status::text = 'pending' then null else 'LEGACY' end,
  case
    when report.status::text in ('resolved', 'rejected')
      then report.created_at + interval '2 microseconds'
    else null
  end,
  report.created_at,
  report.created_at + case report.status::text
    when 'reviewing' then interval '1 microsecond'
    when 'resolved' then interval '2 microseconds'
    when 'rejected' then interval '2 microseconds'
    else interval '0'
  end
from public.moderation_reports as report
on conflict (source_kind, source_report_id) do nothing;

insert into private.moderation_cases (
  source_kind,
  source_report_id,
  state,
  severity,
  assigned_owner,
  sla_due_at,
  policy_code,
  resolved_at,
  created_at,
  updated_at
)
select
  'room_report',
  report.id,
  case report.status
    when 'reviewing' then 'reviewing'
    when 'resolved' then 'resolved'
    when 'dismissed' then 'dismissed'
    else 'pending'
  end,
  private.moderation_severity(report.reason),
  case when report.status = 'pending' then null else 'legacy-import' end,
  report.created_at + case private.moderation_severity(report.reason)
    when 'critical' then interval '4 hours'
    when 'high' then interval '12 hours'
    else interval '24 hours'
  end,
  case when report.status = 'pending' then null else 'LEGACY' end,
  case
    when report.status in ('resolved', 'dismissed')
      then report.created_at + interval '2 microseconds'
    else null
  end,
  report.created_at,
  report.created_at + case report.status
    when 'reviewing' then interval '1 microsecond'
    when 'resolved' then interval '2 microseconds'
    when 'dismissed' then interval '2 microseconds'
    else interval '0'
  end
from public.room_reports as report
on conflict (source_kind, source_report_id) do nothing;

insert into private.moderation_audit_events (
  case_id,
  event_type,
  from_state,
  to_state,
  owner_ref,
  policy_code,
  sanction_code,
  actor_ticket,
  client_request_id,
  payload_hash,
  created_at
)
select
  moderation_case.id,
  'submitted',
  null,
  'pending',
  null,
  'INTAKE',
  'none',
  'USER_SUBMISSION',
  report.client_request_id,
  encode(
    extensions.digest(
      'user_report:' || report.id::text || ':' || report.client_request_id::text,
      'sha256'
    ),
    'hex'
  ),
  report.created_at
from public.moderation_reports as report
join private.moderation_cases as moderation_case
  on moderation_case.source_kind = 'user_report'
 and moderation_case.source_report_id = report.id
on conflict (case_id, client_request_id) do nothing;

insert into private.moderation_audit_events (
  case_id,
  event_type,
  from_state,
  to_state,
  owner_ref,
  policy_code,
  sanction_code,
  actor_ticket,
  client_request_id,
  payload_hash,
  created_at
)
select
  moderation_case.id,
  'submitted',
  null,
  'pending',
  null,
  'INTAKE',
  'none',
  'USER_SUBMISSION',
  report.client_request_id,
  encode(
    extensions.digest(
      'room_report:' || report.id::text || ':' || report.client_request_id::text,
      'sha256'
    ),
    'hex'
  ),
  report.created_at
from public.room_reports as report
join private.moderation_cases as moderation_case
  on moderation_case.source_kind = 'room_report'
 and moderation_case.source_report_id = report.id
on conflict (case_id, client_request_id) do nothing;

with legacy_reports as (
  select
    'user_report'::text as source_kind,
    report.id as source_report_id,
    report.status::text as report_status,
    report.created_at
  from public.moderation_reports as report
  union all
  select
    'room_report'::text,
    report.id,
    report.status,
    report.created_at
  from public.room_reports as report
)
insert into private.moderation_audit_events (
  case_id,
  event_type,
  from_state,
  to_state,
  owner_ref,
  policy_code,
  sanction_code,
  actor_ticket,
  client_request_id,
  payload_hash,
  created_at
)
select
  moderation_case.id,
  'start_review',
  'pending',
  'reviewing',
  'legacy-import',
  'LEGACY',
  'none',
  'MIGRATION_BACKFILL',
  gen_random_uuid(),
  encode(
    extensions.digest(
      'legacy:' || legacy_report.source_kind || ':'
        || legacy_report.source_report_id::text || ':start_review',
      'sha256'
    ),
    'hex'
  ),
  legacy_report.created_at + interval '1 microsecond'
from legacy_reports as legacy_report
join private.moderation_cases as moderation_case
  on moderation_case.source_kind = legacy_report.source_kind
 and moderation_case.source_report_id = legacy_report.source_report_id
where legacy_report.report_status <> 'pending';

with legacy_reports as (
  select
    'user_report'::text as source_kind,
    report.id as source_report_id,
    report.status::text as report_status,
    report.created_at
  from public.moderation_reports as report
  union all
  select
    'room_report'::text,
    report.id,
    report.status,
    report.created_at
  from public.room_reports as report
)
insert into private.moderation_audit_events (
  case_id,
  event_type,
  from_state,
  to_state,
  owner_ref,
  policy_code,
  sanction_code,
  actor_ticket,
  client_request_id,
  payload_hash,
  created_at
)
select
  moderation_case.id,
  case
    when legacy_report.report_status in ('rejected', 'dismissed') then 'dismiss'
    else 'resolve'
  end,
  'reviewing',
  case
    when legacy_report.report_status in ('rejected', 'dismissed') then 'dismissed'
    else 'resolved'
  end,
  'legacy-import',
  'LEGACY',
  'none',
  'MIGRATION_BACKFILL',
  gen_random_uuid(),
  encode(
    extensions.digest(
      'legacy:' || legacy_report.source_kind || ':'
        || legacy_report.source_report_id::text || ':'
        || legacy_report.report_status,
      'sha256'
    ),
    'hex'
  ),
  legacy_report.created_at + interval '2 microseconds'
from legacy_reports as legacy_report
join private.moderation_cases as moderation_case
  on moderation_case.source_kind = legacy_report.source_kind
 and moderation_case.source_report_id = legacy_report.source_report_id
where legacy_report.report_status in ('resolved', 'rejected', 'dismissed');

create trigger moderation_reports_create_case
after insert on public.moderation_reports
for each row execute function private.create_moderation_case_from_report();

create trigger room_reports_create_case
after insert on public.room_reports
for each row execute function private.create_moderation_case_from_report();

drop function if exists public.submit_report(
  uuid,
  public.report_reason,
  text,
  uuid,
  uuid,
  jsonb,
  boolean
);

create function public.submit_report(
  target_user_id uuid,
  reason public.report_reason,
  details text,
  target_event_id uuid default null,
  target_match_id uuid default null,
  client_context jsonb default '{}'::jsonb,
  block_after boolean default false,
  client_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_id uuid := coalesce($8, gen_random_uuid());
  normalized_details text := btrim($3);
  normalized_context jsonb;
  request_hash text;
  previous private.idempotency_records;
  target_match public.matches;
  effective_event_id uuid := target_event_id;
  snapshot jsonb := '{}'::jsonb;
  report_id uuid;
  recent_report_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if reason is null then
    raise exception using errcode = '22023', message = 'Rapor nedeni zorunludur.';
  end if;
  if normalized_details is null
    or char_length(normalized_details) not between 20 and 1500 then
    raise exception using errcode = '22023', message = 'Rapor ayrıntısı 20-1500 karakter olmalı.';
  end if;

  normalized_context := private.validate_report_client_context(client_context);
  request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'target_user_id', target_user_id,
        'reason', reason,
        'details', normalized_details,
        'target_event_id', target_event_id,
        'target_match_id', target_match_id,
        'client_context', normalized_context,
        'block_after', coalesce(block_after, false)
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended('moderation-report-rate:' || current_user_id::text, 0)
  );

  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'submit_report'
    and record.request_id = requested_id;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı rapor istek kimliği farklı veriyle kullanılamaz.';
    end if;
    return (previous.response ->> 'report_id')::uuid;
  end if;

  if target_user_id is null or target_user_id = current_user_id then
    raise exception using errcode = '23514', message = 'Kendini raporlayamazsın.';
  end if;
  if not exists (
    select 1
    from public.profiles as target_profile
    where target_profile.id = target_user_id
      and target_profile.account_disabled_at is null
      and target_profile.onboarding_completed
  ) then
    raise exception using errcode = 'P0002', message = 'Rapor hedefi bulunamadı.';
  end if;
  if private.is_blocked(current_user_id, target_user_id) then
    raise exception using errcode = '42501', message = 'Rapor hedefi artık görünür değil.';
  end if;

  if target_match_id is not null then
    select match_row.* into target_match
    from public.matches as match_row
    where match_row.id = target_match_id
      and current_user_id in (match_row.user1_id, match_row.user2_id)
      and target_user_id in (match_row.user1_id, match_row.user2_id)
      and current_user_id <> target_user_id
      and match_row.status in ('active', 'ended')
      and (
        (current_user_id = match_row.user1_id and match_row.user1_chat_deleted_at is null)
        or (current_user_id = match_row.user2_id and match_row.user2_chat_deleted_at is null)
      );
    if not found then
      raise exception using errcode = '42501', message = 'Rapor eşleşme bağlamı geçersiz.';
    end if;
    if target_event_id is not null and target_event_id <> target_match.event_id then
      raise exception using errcode = '42501', message = 'Rapor etkinlik bağlamı eşleşmeyle uyuşmuyor.';
    end if;
    effective_event_id := target_match.event_id;
    snapshot := jsonb_build_object(
      'scope', 'match',
      'event_id', target_match.event_id,
      'match_status', target_match.status,
      'match_created_at', target_match.created_at
    );
  elsif target_event_id is not null then
    if not exists (
      select 1
      from public.event_attendees as reporter_attendee
      where reporter_attendee.event_id = target_event_id
        and reporter_attendee.user_id = current_user_id
        and reporter_attendee.status = 'joined'
    ) or not exists (
      select 1
      from public.event_attendees as target_attendee
      where target_attendee.event_id = target_event_id
        and target_attendee.user_id = target_user_id
        and target_attendee.status = 'joined'
    ) then
      raise exception using errcode = '42501', message = 'Rapor etkinlik bağlamı görünür değil.';
    end if;
    snapshot := jsonb_build_object('scope', 'event', 'event_id', target_event_id);
  else
    snapshot := jsonb_build_object('scope', 'profile');
  end if;

  select (
    select count(*)
    from public.moderation_reports as report
    where report.reporter_user_id = current_user_id
      and report.created_at > now() - interval '1 hour'
  ) + (
    select count(*)
    from public.room_reports as room_report
    where room_report.reporter_user_id = current_user_id
      and room_report.created_at > now() - interval '1 hour'
  ) into recent_report_count;
  if recent_report_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Çok fazla bildirim gönderdin. Lütfen daha sonra tekrar dene.';
  end if;

  insert into public.moderation_reports (
    reporter_user_id,
    target_user_id,
    event_id,
    match_id,
    reason,
    details,
    context_snapshot,
    client_context,
    client_request_id
  ) values (
    current_user_id,
    target_user_id,
    effective_event_id,
    target_match_id,
    reason,
    normalized_details,
    snapshot,
    normalized_context,
    requested_id
  ) returning id into report_id;

  insert into private.idempotency_records (
    user_id,
    operation,
    request_id,
    payload_hash,
    response
  ) values (
    current_user_id,
    'submit_report',
    requested_id,
    request_hash,
    jsonb_build_object('report_id', report_id)
  );

  if coalesce(block_after, false) then
    perform public.block_user(target_user_id);
  end if;
  return report_id;
end;
$$;

drop function if exists public.submit_room_report(uuid, text, text);

create function public.submit_room_report(
  target_event_id uuid,
  reason text,
  details text,
  client_request_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_id uuid := coalesce($4, gen_random_uuid());
  normalized_reason text := lower(btrim(reason));
  normalized_details text := btrim(details);
  request_hash text;
  previous private.idempotency_records;
  report_id uuid;
  recent_report_count integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if normalized_reason is null
    or normalized_reason not in ('spam', 'harassment', 'unsafe', 'other') then
    raise exception using errcode = '22023', message = 'Geçersiz oda rapor nedeni.';
  end if;
  if normalized_details is null
    or char_length(normalized_details) not between 20 and 1500 then
    raise exception using errcode = '22023', message = 'Rapor ayrıntısı 20-1500 karakter olmalı.';
  end if;

  request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'target_event_id', target_event_id,
        'reason', normalized_reason,
        'details', normalized_details
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended('moderation-report-rate:' || current_user_id::text, 0)
  );

  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'submit_room_report'
    and record.request_id = requested_id;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı rapor istek kimliği farklı veriyle kullanılamaz.';
    end if;
    return (previous.response ->> 'report_id')::uuid;
  end if;

  if not exists (
    select 1
    from public.event_attendees as attendee
    where attendee.event_id = target_event_id
      and attendee.user_id = current_user_id
      and attendee.status = 'joined'
  ) then
    raise exception using errcode = '42501', message = 'Oda rapor erişimi reddedildi.';
  end if;

  select (
    select count(*)
    from public.moderation_reports as report
    where report.reporter_user_id = current_user_id
      and report.created_at > now() - interval '1 hour'
  ) + (
    select count(*)
    from public.room_reports as room_report
    where room_report.reporter_user_id = current_user_id
      and room_report.created_at > now() - interval '1 hour'
  ) into recent_report_count;
  if recent_report_count >= 5 then
    raise exception using
      errcode = 'P0001',
      message = 'Çok fazla bildirim gönderdin. Lütfen daha sonra tekrar dene.';
  end if;

  insert into public.room_reports (
    reporter_user_id,
    event_id,
    reason,
    details,
    client_request_id
  ) values (
    current_user_id,
    target_event_id,
    normalized_reason,
    normalized_details,
    requested_id
  ) returning id into report_id;

  insert into private.idempotency_records (
    user_id,
    operation,
    request_id,
    payload_hash,
    response
  ) values (
    current_user_id,
    'submit_room_report',
    requested_id,
    request_hash,
    jsonb_build_object('report_id', report_id)
  );
  return report_id;
end;
$$;

create or replace function public.moderation_case_transition(
  target_case_id uuid,
  operation text,
  owner_ref text,
  policy_code text,
  actor_ticket text,
  client_request_id uuid,
  sanction_code text default 'none'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_operation text := lower(btrim(operation));
  normalized_owner text := btrim(owner_ref);
  normalized_policy text := upper(btrim(policy_code));
  normalized_ticket text := btrim(actor_ticket);
  normalized_sanction text := lower(btrim(coalesce(sanction_code, 'none')));
  target_case private.moderation_cases;
  previous_audit private.moderation_audit_events;
  next_state text;
  request_hash text;
  audit_id uuid;
begin
  if target_case_id is null or $6 is null then
    raise exception using errcode = '22023', message = 'Case ve istek kimliği zorunludur.';
  end if;
  if normalized_operation is null
    or normalized_operation not in ('start_review', 'resolve', 'dismiss', 'appeal', 'reopen') then
    raise exception using errcode = '22023', message = 'Geçersiz moderasyon işlemi.';
  end if;
  if normalized_owner is null
    or normalized_owner !~ '^[A-Za-z0-9._@:-]{3,80}$' then
    raise exception using errcode = '22023', message = 'Geçersiz moderasyon sahibi.';
  end if;
  if normalized_policy is null
    or normalized_policy !~ '^[A-Z0-9_.-]{2,64}$' then
    raise exception using errcode = '22023', message = 'Geçersiz politika kodu.';
  end if;
  if normalized_ticket is null
    or normalized_ticket !~ '^[A-Za-z0-9._:/-]{3,120}$' then
    raise exception using errcode = '22023', message = 'Geçersiz aktör bileti.';
  end if;
  if normalized_sanction not in (
    'none',
    'warning',
    'temporary_restriction',
    'account_disable_recommendation'
  ) then
    raise exception using errcode = '22023', message = 'Geçersiz yaptırım kodu.';
  end if;
  if normalized_operation <> 'resolve' and normalized_sanction <> 'none' then
    raise exception using errcode = '22023', message = 'Yaptırım yalnızca resolve işleminde kaydedilebilir.';
  end if;

  request_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'case_id', target_case_id,
        'operation', normalized_operation,
        'owner_ref', normalized_owner,
        'policy_code', normalized_policy,
        'actor_ticket', normalized_ticket,
        'sanction_code', normalized_sanction
      )::text,
      'sha256'
    ),
    'hex'
  );

  select moderation_case.* into target_case
  from private.moderation_cases as moderation_case
  where moderation_case.id = target_case_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Moderasyon case bulunamadı.';
  end if;

  select audit_event.* into previous_audit
  from private.moderation_audit_events as audit_event
  where audit_event.case_id = target_case_id
    and audit_event.client_request_id = $6;
  if found then
    if previous_audit.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı moderasyon istek kimliği farklı veriyle kullanılamaz.';
    end if;
    return previous_audit.id;
  end if;

  next_state := case normalized_operation
    when 'start_review' then 'reviewing'
    when 'resolve' then 'resolved'
    when 'dismiss' then 'dismissed'
    when 'appeal' then 'appealed'
    when 'reopen' then 'reviewing'
  end;

  if (normalized_operation = 'start_review' and target_case.state <> 'pending')
    or (normalized_operation in ('resolve', 'dismiss') and target_case.state <> 'reviewing')
    or (normalized_operation = 'appeal' and target_case.state not in ('resolved', 'dismissed'))
    or (normalized_operation = 'reopen' and target_case.state <> 'appealed') then
    raise exception using errcode = '22023', message = 'Geçersiz moderasyon durum geçişi.';
  end if;

  update private.moderation_cases
  set
    state = next_state,
    assigned_owner = normalized_owner,
    policy_code = normalized_policy,
    sanction_code = normalized_sanction,
    appeal_count = appeal_count + case when normalized_operation = 'appeal' then 1 else 0 end,
    resolved_at = case
      when next_state in ('resolved', 'dismissed') then clock_timestamp()
      else null
    end,
    sla_due_at = case
      when next_state = 'appealed' then clock_timestamp() + case target_case.severity
        when 'critical' then interval '4 hours'
        when 'high' then interval '12 hours'
        else interval '24 hours'
      end
      else sla_due_at
    end,
    updated_at = clock_timestamp()
  where id = target_case_id;

  if target_case.source_kind = 'user_report' then
    update public.moderation_reports
    set status = (case next_state
      when 'pending' then 'pending'
      when 'reviewing' then 'reviewing'
      when 'resolved' then 'resolved'
      when 'dismissed' then 'rejected'
      when 'appealed' then 'reviewing'
    end)::public.report_status
    where id = target_case.source_report_id;
  else
    update public.room_reports
    set status = case next_state
      when 'pending' then 'pending'
      when 'reviewing' then 'reviewing'
      when 'resolved' then 'resolved'
      when 'dismissed' then 'dismissed'
      when 'appealed' then 'reviewing'
    end
    where id = target_case.source_report_id;
  end if;

  insert into private.moderation_audit_events (
    case_id,
    event_type,
    from_state,
    to_state,
    owner_ref,
    policy_code,
    sanction_code,
    actor_ticket,
    client_request_id,
    payload_hash
  ) values (
    target_case_id,
    normalized_operation,
    target_case.state,
    next_state,
    normalized_owner,
    normalized_policy,
    normalized_sanction,
    normalized_ticket,
    $6,
    request_hash
  ) returning id into audit_id;

  return audit_id;
end;
$$;

create or replace function public.get_moderation_case(target_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', moderation_case.id,
    'source_kind', moderation_case.source_kind,
    'source_report_id', moderation_case.source_report_id,
    'state', moderation_case.state,
    'severity', moderation_case.severity,
    'assigned_owner', moderation_case.assigned_owner,
    'sla_due_at', moderation_case.sla_due_at,
    'policy_code', moderation_case.policy_code,
    'sanction_code', moderation_case.sanction_code,
    'appeal_count', moderation_case.appeal_count,
    'resolved_at', moderation_case.resolved_at,
    'report', case moderation_case.source_kind
      when 'user_report' then (
        select jsonb_build_object(
          'id', report.id,
          'reporter_user_id', report.reporter_user_id,
          'target_user_id', report.target_user_id,
          'event_id', report.event_id,
          'match_id', report.match_id,
          'reason', report.reason,
          'details', report.details,
          'context_snapshot', report.context_snapshot,
          'client_context', report.client_context,
          'created_at', report.created_at
        )
        from public.moderation_reports as report
        where report.id = moderation_case.source_report_id
      )
      else (
        select jsonb_build_object(
          'id', room_report.id,
          'reporter_user_id', room_report.reporter_user_id,
          'event_id', room_report.event_id,
          'reason', room_report.reason,
          'details', room_report.details,
          'created_at', room_report.created_at
        )
        from public.room_reports as room_report
        where room_report.id = moderation_case.source_report_id
      )
    end,
    'audit_events', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', audit_event.id,
            'event_type', audit_event.event_type,
            'from_state', audit_event.from_state,
            'to_state', audit_event.to_state,
            'owner_ref', audit_event.owner_ref,
            'policy_code', audit_event.policy_code,
            'sanction_code', audit_event.sanction_code,
            'actor_ticket', audit_event.actor_ticket,
            'client_request_id', audit_event.client_request_id,
            'created_at', audit_event.created_at
          ) order by audit_event.created_at, audit_event.id
        )
        from private.moderation_audit_events as audit_event
        where audit_event.case_id = moderation_case.id
      ),
      '[]'::jsonb
    )
  ) into result
  from private.moderation_cases as moderation_case
  where moderation_case.id = target_case_id;

  return result;
end;
$$;

revoke all on function private.moderation_severity(text)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_report_client_context(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.reject_moderation_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.create_moderation_case_from_report()
  from public, anon, authenticated, service_role;

revoke all on function public.submit_report(
  uuid,
  public.report_reason,
  text,
  uuid,
  uuid,
  jsonb,
  boolean,
  uuid
) from public, anon;
grant execute on function public.submit_report(
  uuid,
  public.report_reason,
  text,
  uuid,
  uuid,
  jsonb,
  boolean,
  uuid
) to authenticated;

revoke all on function public.submit_room_report(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.submit_room_report(uuid, text, text, uuid)
  to authenticated;

revoke all on function public.moderation_case_transition(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text
) from public, anon, authenticated;
grant execute on function public.moderation_case_transition(
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  text
) to service_role;

revoke all on function public.get_moderation_case(uuid)
  from public, anon, authenticated;
grant execute on function public.get_moderation_case(uuid)
  to service_role;

commit;
