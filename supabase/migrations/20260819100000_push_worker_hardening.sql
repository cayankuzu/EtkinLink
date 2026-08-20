begin;

create extension if not exists supabase_vault with schema vault;

alter table public.notification_events
  add column if not exists processing_started_at timestamptz;

alter table public.notification_deliveries
  add column if not exists receipt_attempt_count smallint not null default 0,
  add column if not exists receipt_next_attempt_at timestamptz;

update public.notification_deliveries
set receipt_status = 'permanent_failure'
where receipt_status = 'failed';

update public.notification_deliveries
set receipt_status = 'pending',
    receipt_next_attempt_at = greatest(created_at + interval '15 minutes', now())
where status = 'sent'
  and expo_ticket_id is not null
  and receipt_checked_at is null
  and receipt_status is null;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_receipt_status_check,
  drop constraint if exists notification_deliveries_receipt_attempts_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_receipt_status_check
    check (
      receipt_status is null
      or receipt_status in (
        'pending',
        'delivered',
        'invalid_token',
        'retryable',
        'permanent_failure'
      )
    ),
  add constraint notification_deliveries_receipt_attempts_check
    check (receipt_attempt_count between 0 and 5);

drop index if exists public.idx_notification_deliveries_pending_receipts;
create index idx_notification_deliveries_pending_receipts
  on public.notification_deliveries (receipt_next_attempt_at, created_at, id)
  where status = 'sent'
    and expo_ticket_id is not null
    and receipt_checked_at is null;

create index if not exists notification_events_stale_processing_idx
  on public.notification_events (processing_started_at, created_at)
  where delivery_status = 'processing';

create or replace function public.claim_notification_event(target_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.notification_events;
  token_payload jsonb;
begin
  select event.* into target_event
  from public.notification_events as event
  where event.id = target_event_id
    and (
      (
        event.delivery_status in ('pending', 'failed')
        and event.next_attempt_at <= now()
      )
      or (
        event.delivery_status = 'processing'
        and event.processing_started_at < now() - interval '10 minutes'
      )
    )
    and event.attempt_count < 5
  for update skip locked;

  if not found then return null; end if;

  update public.notification_events
  set delivery_status = 'processing',
      processing_started_at = now(),
      attempt_count = attempt_count + 1,
      last_error_code = null
  where id = target_event.id
  returning * into target_event;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', token.id,
        'token', token.expo_push_token,
        'platform', token.platform
      )
      order by token.last_seen_at desc
    ),
    '[]'::jsonb
  ) into token_payload
  from public.push_tokens as token
  where token.user_id = target_event.user_id
    and token.disabled_at is null
    and token.last_seen_at > now() - interval '120 days';

  if jsonb_array_length(token_payload) = 0 then
    update public.notification_events
    set delivery_status = 'cancelled',
        processing_started_at = null,
        last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
    where id = target_event.id;
  end if;

  return jsonb_build_object('event', to_jsonb(target_event), 'tokens', token_payload);
end;
$$;

create or replace function public.claim_notification_events(
  requested_batch_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(requested_batch_size, 20), 1), 25);
  target_event public.notification_events;
  token_payload jsonb;
  result_payload jsonb := '[]'::jsonb;
begin
  update public.notification_events
  set delivery_status = 'cancelled',
      processing_started_at = null,
      last_error_code = 'MAX_ATTEMPTS_EXHAUSTED'
  where delivery_status in ('pending', 'failed', 'processing')
    and attempt_count >= 5;

  for target_event in
    select event.*
    from public.notification_events as event
    where (
      (
        event.delivery_status in ('pending', 'failed')
        and event.next_attempt_at <= now()
      )
      or (
        event.delivery_status = 'processing'
        and event.processing_started_at < now() - interval '10 minutes'
      )
    )
      and event.attempt_count < 5
    order by event.created_at, event.id
    limit safe_batch_size
    for update skip locked
  loop
    update public.notification_events
    set delivery_status = 'processing',
        processing_started_at = now(),
        attempt_count = attempt_count + 1,
        last_error_code = null
    where id = target_event.id
    returning * into target_event;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', token.id,
          'token', token.expo_push_token,
          'platform', token.platform
        )
        order by token.last_seen_at desc
      ),
      '[]'::jsonb
    ) into token_payload
    from public.push_tokens as token
    where token.user_id = target_event.user_id
      and token.disabled_at is null
      and token.last_seen_at > now() - interval '120 days';

    if jsonb_array_length(token_payload) = 0 then
      update public.notification_events
      set delivery_status = 'cancelled',
          processing_started_at = null,
          last_error_code = 'NO_ACTIVE_PUSH_TOKEN'
      where id = target_event.id;
    else
      result_payload := result_payload || jsonb_build_array(
        jsonb_build_object('event', to_jsonb(target_event), 'tokens', token_payload)
      );
    end if;
  end loop;

  return result_payload;
end;
$$;

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
  result_payload jsonb := '[]'::jsonb;
begin
  for target_delivery in
    select delivery.*
    from public.notification_deliveries as delivery
    where delivery.status = 'sent'
      and delivery.expo_ticket_id is not null
      and delivery.receipt_checked_at is null
      and coalesce(delivery.receipt_status, 'pending') in ('pending', 'retryable')
      and coalesce(
        delivery.receipt_next_attempt_at,
        delivery.created_at + interval '15 minutes'
      ) <= now()
    order by coalesce(
      delivery.receipt_next_attempt_at,
      delivery.created_at + interval '15 minutes'
    ), delivery.created_at, delivery.id
    limit safe_batch_size
    for update skip locked
  loop
    update public.notification_deliveries
    set receipt_next_attempt_at = now() + interval '2 minutes'
    where id = target_delivery.id;

    result_payload := result_payload || jsonb_build_array(
      jsonb_build_object(
        'id', target_delivery.id,
        'expo_ticket_id', target_delivery.expo_ticket_id,
        'push_token_id', target_delivery.push_token_id,
        'receipt_attempt_count', target_delivery.receipt_attempt_count
      )
    );
  end loop;

  return result_payload;
end;
$$;

create or replace function private.push_worker_setting(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from vault.decrypted_secrets as secret
  where secret.name = secret_name
  order by secret.created_at desc
  limit 1;
$$;

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

  select net.http_post(
    url := rtrim(worker_base_url, '/') || '/' || worker_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-secret', worker_secret
    ),
    body := coalesce(request_body, '{}'::jsonb),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

create or replace function private.dispatch_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.invoke_push_worker(
    'push-dispatch',
    jsonb_build_object('eventId', new.id)
  );
  return new;
end;
$$;

revoke all on function public.claim_notification_event(uuid) from public;
revoke all on function public.claim_notification_events(integer) from public;
revoke all on function public.claim_pending_push_receipts(integer) from public;
grant execute on function public.claim_notification_event(uuid) to service_role;
grant execute on function public.claim_notification_events(integer) to service_role;
grant execute on function public.claim_pending_push_receipts(integer) to service_role;

revoke all on function private.push_worker_setting(text) from public;
revoke all on function private.invoke_push_worker(text, jsonb) from public;
revoke all on function private.dispatch_notification_event() from public;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'etkinlink-push-outbox-drain',
      'etkinlink-push-receipts'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'etkinlink-push-outbox-drain',
  '* * * * *',
  $job$
    select private.invoke_push_worker(
      'push-dispatch',
      jsonb_build_object('drain', true, 'batchSize', 20)
    );
  $job$
);

select cron.schedule(
  'etkinlink-push-receipts',
  '*/5 * * * *',
  $job$
    select private.invoke_push_worker('push-receipts', '{}'::jsonb);
  $job$
);

comment on function private.invoke_push_worker(text, jsonb) is
  'Vault içindeki edge_functions_base_url ve push_worker_secret ile korumalı worker çağrısı yapar.';
comment on function public.claim_notification_events(integer) is
  'En eski uygun push olaylarını SKIP LOCKED ile kontrollü bir batch olarak claim eder.';
comment on function public.claim_pending_push_receipts(integer) is
  'Teslimat makbuzlarını SKIP LOCKED ve iki dakikalık lease ile tek worker için claim eder.';

commit;
