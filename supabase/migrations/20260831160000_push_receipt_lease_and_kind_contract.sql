begin;

-- Build and validate the replacement while the old constraint remains live.
-- Only the final metadata swap needs the short ACCESS EXCLUSIVE lock.
alter table public.notification_events
  add constraint notification_events_kind_v2 check (
    kind in (
      'new_like',
      'new_match',
      'direct_message',
      'room_message',
      'match_ended',
      'event_reminder',
      'system',
      'blocked',
      'unblocked'
    )
  ) not valid;

alter table public.notification_events
  validate constraint notification_events_kind_v2;

alter table public.notification_events
  drop constraint notification_events_kind;

alter table public.notification_events
  rename constraint notification_events_kind_v2 to notification_events_kind;

alter table public.notification_deliveries
  add column if not exists receipt_lease_id uuid;

update public.notification_deliveries
set receipt_next_attempt_at = created_at + interval '15 minutes'
where status = 'sent'
  and expo_ticket_id is not null
  and receipt_checked_at is null
  and coalesce(receipt_status, 'pending') in ('pending', 'retryable')
  and receipt_attempt_count < 5
  and receipt_next_attempt_at is null;

alter table public.notification_deliveries
  add constraint notification_deliveries_receipt_schedule_check
  check (
    not (
      status = 'sent'
      and expo_ticket_id is not null
      and receipt_checked_at is null
      and coalesce(receipt_status, 'pending') in ('pending', 'retryable')
      and receipt_attempt_count < 5
    )
    or receipt_next_attempt_at is not null
  ) not valid;

alter table public.notification_deliveries
  validate constraint notification_deliveries_receipt_schedule_check;

create index if not exists notification_deliveries_receipt_claim_idx
  on public.notification_deliveries (
    receipt_next_attempt_at,
    created_at,
    id
  )
  where status = 'sent'
    and expo_ticket_id is not null
    and receipt_checked_at is null
    and coalesce(receipt_status, 'pending') in ('pending', 'retryable')
    and receipt_attempt_count < 5;

create or replace function public.claim_pending_push_receipts(
  requested_batch_size integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(requested_batch_size, 300), 1), 300);
  target_delivery public.notification_deliveries;
  target_lease_id uuid;
  result_payload jsonb := '[]'::jsonb;
begin
  -- Repair any pre-existing exhausted row into the logical receipt DLQ before
  -- claiming more work. New writes reach the same state through the CAS RPC.
  update public.notification_deliveries
  set receipt_status = 'permanent_failure',
      receipt_next_attempt_at = null,
      receipt_lease_id = null,
      receipt_checked_at = coalesce(receipt_checked_at, clock_timestamp()),
      receipt_error_code = coalesce(
        receipt_error_code,
        'MAX_RECEIPT_ATTEMPTS_EXHAUSTED'
      ),
      updated_at = clock_timestamp()
  where status = 'sent'
    and expo_ticket_id is not null
    and receipt_checked_at is null
    and coalesce(receipt_status, 'pending') in ('pending', 'retryable')
    and receipt_attempt_count >= 5;

  for target_delivery in
    select delivery.*
    from public.notification_deliveries as delivery
    where delivery.status = 'sent'
      and delivery.expo_ticket_id is not null
      and delivery.receipt_checked_at is null
      and coalesce(delivery.receipt_status, 'pending') in ('pending', 'retryable')
      and delivery.receipt_attempt_count < 5
      and delivery.receipt_next_attempt_at <= now()
    order by delivery.receipt_next_attempt_at, delivery.created_at, delivery.id
    limit safe_batch_size
    for update skip locked
  loop
    target_lease_id := gen_random_uuid();

    update public.notification_deliveries
    set receipt_next_attempt_at = now() + interval '2 minutes',
        receipt_lease_id = target_lease_id,
        updated_at = clock_timestamp()
    where id = target_delivery.id;

    result_payload := result_payload || jsonb_build_array(
      jsonb_build_object(
        'id', target_delivery.id,
        'expo_ticket_id', target_delivery.expo_ticket_id,
        'push_token_id', target_delivery.push_token_id,
        'receipt_attempt_count', target_delivery.receipt_attempt_count,
        'receipt_lease_id', target_lease_id
      )
    );
  end loop;

  return result_payload;
end;
$$;

create or replace function public.persist_push_receipt_result(
  target_delivery_id uuid,
  expected_receipt_attempt_count integer,
  expected_receipt_lease_id uuid,
  result_status text,
  result_error_code text default null,
  result_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery public.notification_deliveries;
  next_attempt_count integer;
  final_status text;
  final_error_code text;
begin
  if target_delivery_id is null
    or expected_receipt_lease_id is null
    or expected_receipt_attempt_count is null
    or expected_receipt_attempt_count not between 0 and 4
    or result_status not in (
      'delivered',
      'invalid_token',
      'retryable',
      'permanent_failure'
    )
    or (
      result_error_code is not null
      and char_length(result_error_code) > 120
    )
    or (
      result_error_message is not null
      and char_length(result_error_message) > 500
    ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid push receipt result.';
  end if;

  select delivery.* into target_delivery
  from public.notification_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;

  if not found then
    return false;
  end if;

  -- A late worker must never overwrite a newer lease or a terminal receipt.
  if target_delivery.status <> 'sent'
    or target_delivery.receipt_checked_at is not null
    or coalesce(target_delivery.receipt_status, 'pending')
      not in ('pending', 'retryable')
    or target_delivery.receipt_attempt_count <>
      expected_receipt_attempt_count
    or target_delivery.receipt_lease_id is distinct from
      expected_receipt_lease_id then
    return false;
  end if;

  next_attempt_count := expected_receipt_attempt_count + 1;
  final_status := result_status;
  final_error_code := result_error_code;

  if result_status = 'retryable' and next_attempt_count >= 5 then
    final_status := 'permanent_failure';
    final_error_code := 'MAX_RECEIPT_ATTEMPTS_EXHAUSTED';
  end if;

  if final_status = 'invalid_token' then
    update public.push_tokens
    set disabled_at = coalesce(disabled_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = target_delivery.push_token_id;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'Push token not found.';
    end if;
  end if;

  update public.notification_deliveries
  set receipt_status = final_status,
      receipt_attempt_count = next_attempt_count,
      receipt_next_attempt_at = case
        when final_status = 'retryable' then
          clock_timestamp() + make_interval(
            mins => case next_attempt_count
              when 1 then 5
              when 2 then 10
              when 3 then 20
              when 4 then 40
              else 60
            end
          ) + make_interval(secs => floor(random() * 61)::integer)
        else null
      end,
      receipt_lease_id = null,
      receipt_checked_at = case
        when final_status = 'retryable' then null
        else clock_timestamp()
      end,
      receipt_error_code = final_error_code,
      error_message = result_error_message,
      updated_at = clock_timestamp()
  where id = target_delivery_id;

  return true;
end;
$$;

revoke all on function public.claim_pending_push_receipts(integer)
  from public, anon, authenticated;
grant execute on function public.claim_pending_push_receipts(integer) to service_role;

revoke all on function public.persist_push_receipt_result(
  uuid,
  integer,
  uuid,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.persist_push_receipt_result(
  uuid,
  integer,
  uuid,
  text,
  text,
  text
) to service_role;

comment on function public.claim_pending_push_receipts(integer) is
  'Claims bounded receipt work with SKIP LOCKED and a unique two-minute lease; exhausted rows enter the logical DLQ.';
comment on function public.persist_push_receipt_result(uuid, integer, uuid, text, text, text) is
  'Persists one receipt result with attempt and lease CAS; retries stop at five and invalid tokens are disabled atomically.';

commit;
