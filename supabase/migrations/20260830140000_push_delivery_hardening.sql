begin;

create table private.push_worker_nonces (
  nonce uuid primary key,
  scope text not null,
  requested_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  constraint push_worker_nonces_scope_check
    check (scope in ('push-dispatch', 'push-receipts'))
);

create index push_worker_nonces_consumed_at_idx
  on private.push_worker_nonces (consumed_at);

revoke all on table private.push_worker_nonces from public, anon, authenticated;

create or replace function public.consume_push_worker_nonce(
  request_nonce uuid,
  request_scope text,
  request_timestamp bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer := 0;
  request_time timestamptz;
begin
  if request_nonce is null
    or request_scope not in ('push-dispatch', 'push-receipts')
    or request_timestamp is null then
    return false;
  end if;

  if abs(request_timestamp::numeric - extract(epoch from now())) > 300 then
    return false;
  end if;
  request_time := to_timestamp(request_timestamp);

  delete from private.push_worker_nonces
  where consumed_at < now() - interval '1 day';

  insert into private.push_worker_nonces (nonce, scope, requested_at)
  values (request_nonce, request_scope, request_time)
  on conflict (nonce) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.consume_push_worker_nonce(uuid, text, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_push_worker_nonce(uuid, text, bigint)
  to service_role;

create table private.notification_delivery_replay_audit (
  id uuid primary key default gen_random_uuid(),
  client_request_id uuid not null unique,
  notification_event_id uuid not null,
  reason text not null,
  requested_role text not null,
  previous_delivery_status text not null,
  previous_attempt_count smallint not null,
  terminal_delivery_count integer not null,
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint notification_delivery_replay_reason_check
    check (char_length(reason) between 10 and 500),
  constraint notification_delivery_replay_count_check
    check (terminal_delivery_count >= 0)
);

revoke all on table private.notification_delivery_replay_audit
  from public, anon, authenticated, service_role;

create or replace function private.prevent_notification_replay_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'Push replay audit kayıtları değiştirilemez.';
end;
$$;

create trigger notification_delivery_replay_audit_immutable
before update or delete on private.notification_delivery_replay_audit
for each row execute function private.prevent_notification_replay_audit_mutation();

revoke all on function private.prevent_notification_replay_audit_mutation()
  from public;

create or replace function public.persist_invalid_push_receipt(
  target_delivery_id uuid,
  expected_receipt_attempt_count integer,
  result_error_code text,
  result_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery public.notification_deliveries;
begin
  if target_delivery_id is null
    or expected_receipt_attempt_count is null
    or expected_receipt_attempt_count not between 0 and 5
    or result_error_code is distinct from 'DeviceNotRegistered'
    or (
      result_error_message is not null
      and char_length(result_error_message) > 500
    ) then
    raise exception using
      errcode = '22023',
      message = 'Geçersiz push receipt sonucu.';
  end if;

  select delivery.* into target_delivery
  from public.notification_deliveries as delivery
  where delivery.id = target_delivery_id
  for update;

  if not found then
    return false;
  end if;

  if target_delivery.receipt_checked_at is not null then
    return target_delivery.receipt_status = 'invalid_token'
      and exists (
        select 1
        from public.push_tokens as token
        where token.id = target_delivery.push_token_id
          and token.disabled_at is not null
      );
  end if;

  if target_delivery.status <> 'sent'
    or coalesce(target_delivery.receipt_status, 'pending')
      not in ('pending', 'retryable')
    or target_delivery.receipt_attempt_count <>
      expected_receipt_attempt_count then
    return false;
  end if;

  update public.push_tokens
  set disabled_at = coalesce(disabled_at, clock_timestamp())
  where id = target_delivery.push_token_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Push token bulunamadı.';
  end if;

  update public.notification_deliveries
  set
    receipt_status = 'invalid_token',
    receipt_attempt_count = least(expected_receipt_attempt_count + 1, 5),
    receipt_next_attempt_at = null,
    receipt_checked_at = clock_timestamp(),
    receipt_error_code = result_error_code,
    error_message = result_error_message,
    updated_at = clock_timestamp()
  where id = target_delivery_id;

  return true;
end;
$$;

revoke all on function public.persist_invalid_push_receipt(
  uuid,
  integer,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.persist_invalid_push_receipt(
  uuid,
  integer,
  text,
  text
) to service_role;

create or replace function public.query_terminal_notification_delivery(
  target_event_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'eventId', event.id,
    'deliveryStatus', event.delivery_status,
    'attemptCount', event.attempt_count,
    'lastErrorCode', event.last_error_code,
    'nextAttemptAt', event.next_attempt_at,
    'isTerminal', (
      event.delivery_status = 'cancelled'
      or event.attempt_count >= 5
      or exists (
        select 1
        from public.notification_deliveries as terminal_delivery
        where terminal_delivery.notification_event_id = event.id
          and terminal_delivery.receipt_status in (
            'invalid_token',
            'permanent_failure'
          )
      )
    ),
    'deliveries', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', delivery.id,
            'status', delivery.status,
            'errorCode', delivery.error_code,
            'receiptStatus', delivery.receipt_status,
            'receiptErrorCode', delivery.receipt_error_code,
            'receiptAttemptCount', delivery.receipt_attempt_count,
            'updatedAt', delivery.updated_at
          )
          order by delivery.created_at, delivery.id
        )
        from public.notification_deliveries as delivery
        where delivery.notification_event_id = event.id
      ),
      '[]'::jsonb
    )
  )
  from public.notification_events as event
  where event.id = target_event_id;
$$;

create or replace function public.replay_terminal_notification_delivery(
  target_event_id uuid,
  client_request_id uuid,
  replay_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.notification_events;
  existing_audit private.notification_delivery_replay_audit;
  audit_id uuid := gen_random_uuid();
  normalized_reason text := btrim(replay_reason);
  terminal_delivery_count integer := 0;
  result_payload jsonb;
begin
  if target_event_id is null or client_request_id is null then
    raise exception using errcode = '22023', message = 'Event ve istek kimliği gereklidir.';
  end if;
  if char_length(coalesce(normalized_reason, '')) not between 10 and 500 then
    raise exception using errcode = '22023', message = 'Replay gerekçesi 10-500 karakter olmalıdır.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(client_request_id::text, 0));
  select audit.* into existing_audit
  from private.notification_delivery_replay_audit as audit
  where audit.client_request_id = replay_terminal_notification_delivery.client_request_id;
  if found then
    if existing_audit.notification_event_id <> target_event_id
      or existing_audit.reason <> normalized_reason then
      raise exception using
        errcode = '22023',
        message = 'PUSH_REPLAY_IDEMPOTENCY_CONFLICT';
    end if;
    return existing_audit.response_payload;
  end if;

  select event.* into target_event
  from public.notification_events as event
  where event.id = target_event_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bildirim event kaydı bulunamadı.';
  end if;

  select count(*)::integer into terminal_delivery_count
  from public.notification_deliveries as delivery
  where delivery.notification_event_id = target_event_id
    and delivery.receipt_status in ('invalid_token', 'permanent_failure');

  if target_event.delivery_status <> 'cancelled'
    and target_event.attempt_count < 5
    and terminal_delivery_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'PUSH_REPLAY_NOT_TERMINAL';
  end if;

  update public.notification_deliveries
  set status = 'failed',
      expo_ticket_id = null,
      error_code = 'OPS_REPLAY_REQUESTED',
      error_message = null,
      receipt_status = null,
      receipt_attempt_count = 0,
      receipt_next_attempt_at = null,
      receipt_checked_at = null,
      receipt_error_code = null,
      updated_at = now()
  where notification_event_id = target_event_id
    and (
      status = 'failed'
      or receipt_status in ('invalid_token', 'permanent_failure')
    );

  update public.notification_events
  set delivery_status = 'failed',
      attempt_count = 0,
      next_attempt_at = now(),
      processing_started_at = null,
      delivered_at = null,
      last_error_code = 'OPS_REPLAY_REQUESTED'
  where id = target_event_id;

  result_payload := jsonb_build_object(
    'auditId', audit_id,
    'eventId', target_event_id,
    'clientRequestId', client_request_id,
    'replayed', true
  );

  insert into private.notification_delivery_replay_audit (
    id,
    client_request_id,
    notification_event_id,
    reason,
    requested_role,
    previous_delivery_status,
    previous_attempt_count,
    terminal_delivery_count,
    response_payload
  )
  values (
    audit_id,
    client_request_id,
    target_event_id,
    normalized_reason,
    coalesce(auth.role(), 'service_role'),
    target_event.delivery_status,
    target_event.attempt_count,
    terminal_delivery_count,
    result_payload
  );

  return result_payload;
end;
$$;

revoke all on function public.query_terminal_notification_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.replay_terminal_notification_delivery(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.query_terminal_notification_delivery(uuid)
  to service_role;
grant execute on function public.replay_terminal_notification_delivery(uuid, uuid, text)
  to service_role;

create or replace function private.invoke_push_worker(
  worker_name text,
  request_body jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_base_url text;
  worker_secret text;
  request_id bigint;
  request_timestamp bigint;
  request_nonce uuid;
  canonical_body text;
  signature text;
begin
  if worker_name not in ('push-dispatch', 'push-receipts') then
    raise exception using errcode = '22023', message = 'Geçersiz push worker adı.';
  end if;

  worker_base_url := private.push_worker_setting('edge_functions_base_url');
  worker_secret := private.push_worker_setting('push_worker_secret');

  if worker_base_url is null
    or worker_base_url !~ '^https://'
    or char_length(worker_base_url) > 500
    or char_length(coalesce(worker_secret, '')) < 32 then
    raise warning 'Push worker Vault yapılandırması eksik veya geçersiz.';
    return null;
  end if;

  request_timestamp := floor(extract(epoch from now()))::bigint;
  request_nonce := gen_random_uuid();
  canonical_body := coalesce(request_body, '{}'::jsonb)::text;
  signature := encode(
    extensions.hmac(
      convert_to(
        request_timestamp::text || E'\n' ||
        request_nonce::text || E'\n' ||
        worker_name || E'\n' ||
        canonical_body,
        'UTF8'
      ),
      convert_to(worker_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := rtrim(worker_base_url, '/') || '/' || worker_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-timestamp', request_timestamp::text,
      'x-push-worker-nonce', request_nonce::text,
      'x-push-worker-signature', 'v1=' || signature
    ),
    body := coalesce(request_body, '{}'::jsonb),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function private.invoke_push_worker(text, jsonb) from public;

comment on function public.consume_push_worker_nonce(uuid, text, bigint) is
  'Consumes a fresh, endpoint-scoped worker nonce exactly once within a five-minute clock-skew window.';
comment on function public.persist_invalid_push_receipt(uuid, integer, text, text) is
  'Atomically disables a permanently invalid push token and records its terminal receipt result; service-role only.';
comment on function public.query_terminal_notification_delivery(uuid) is
  'Service-role-only technical query for terminal push delivery state; returns no message body or payload.';
comment on function public.replay_terminal_notification_delivery(uuid, uuid, text) is
  'Service-role-only, audited and idempotent replay control for terminal push delivery states; disabled tokens stay disabled and only currently active tokens can be claimed.';
comment on function private.invoke_push_worker(text, jsonb) is
  'Invokes one of the two push workers with a body-bound, endpoint-scoped HMAC, timestamp, and one-time UUID nonce.';

commit;
