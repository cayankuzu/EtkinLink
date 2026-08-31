begin;

alter table private.account_deletion_requests
  add column continuation_attempt_count smallint not null default 0,
  add column continuation_next_attempt_at timestamptz,
  add column continuation_lease_until timestamptz,
  add column continuation_terminal_at timestamptz,
  add column continuation_last_error_code text,
  add column continuation_last_error_at timestamptz,
  add constraint account_deletion_continuation_attempt_check
    check (continuation_attempt_count between 0 and 8),
  add constraint account_deletion_continuation_error_code_check
    check (
      continuation_last_error_code is null
      or continuation_last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    );

update private.account_deletion_requests
set continuation_next_attempt_at = clock_timestamp()
where phase in ('auth_deleted', 'storage_deleting')
  and continuation_terminal_at is null
  and continuation_next_attempt_at is null;

create index account_deletion_continuation_due_idx
on private.account_deletion_requests (
  continuation_next_attempt_at,
  continuation_lease_until,
  updated_at,
  client_request_id
)
where phase in ('auth_deleted', 'storage_deleting')
  and continuation_terminal_at is null
  and continuation_attempt_count < 8;

create table private.account_deletion_worker_nonces (
  nonce uuid primary key,
  requested_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp()
);

alter table private.account_deletion_worker_nonces enable row level security;
alter table private.account_deletion_worker_nonces force row level security;
revoke all on table private.account_deletion_worker_nonces
from public, anon, authenticated, service_role;

create index account_deletion_worker_nonces_consumed_at_idx
on private.account_deletion_worker_nonces (consumed_at);

create or replace function public.consume_account_deletion_worker_nonce(
  request_nonce uuid,
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
  if request_nonce is null or request_timestamp is null then
    return false;
  end if;

  if abs(request_timestamp::numeric - extract(epoch from clock_timestamp())) > 300 then
    return false;
  end if;
  request_time := to_timestamp(request_timestamp);

  delete from private.account_deletion_worker_nonces
  where consumed_at < clock_timestamp() - interval '1 day';

  insert into private.account_deletion_worker_nonces (nonce, requested_at)
  values (request_nonce, request_time)
  on conflict (nonce) do nothing;
  get diagnostics inserted_count = row_count;

  return inserted_count = 1;
end;
$$;

create or replace function private.terminalize_expired_account_deletion_claims()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  terminalized_count integer := 0;
begin
  update private.account_deletion_requests as request
  set
    continuation_lease_until = null,
    continuation_next_attempt_at = null,
    continuation_terminal_at = coalesce(
      request.continuation_terminal_at,
      clock_timestamp()
    ),
    continuation_last_error_code = coalesce(
      request.continuation_last_error_code,
      'CONTINUATION_LEASE_EXPIRED'
    ),
    continuation_last_error_at = coalesce(
      request.continuation_last_error_at,
      clock_timestamp()
    ),
    updated_at = clock_timestamp()
  where request.phase in ('auth_deleted', 'storage_deleting')
    and request.continuation_terminal_at is null
    and request.continuation_attempt_count >= 8
    and request.continuation_lease_until <= clock_timestamp();
  get diagnostics terminalized_count = row_count;
  return terminalized_count;
end;
$$;

create or replace function public.claim_account_deletion_continuations(
  requested_batch_size integer default 5
)
returns table (
  user_id uuid,
  client_request_id uuid,
  phase text,
  continuation_attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(
    greatest(coalesce(requested_batch_size, 5), 1),
    10
  );
begin
  perform private.terminalize_expired_account_deletion_claims();

  return query
  with candidates as (
    select
      request.user_id,
      request.client_request_id
    from private.account_deletion_requests as request
    where request.phase in ('auth_deleted', 'storage_deleting')
      and request.continuation_terminal_at is null
      and request.continuation_attempt_count < 8
      and coalesce(
        request.continuation_next_attempt_at,
        '-infinity'::timestamptz
      ) <= clock_timestamp()
      and coalesce(
        request.continuation_lease_until,
        '-infinity'::timestamptz
      ) <= clock_timestamp()
    order by
      request.continuation_next_attempt_at nulls first,
      request.updated_at,
      request.client_request_id
    limit safe_batch_size
    for update skip locked
  )
  update private.account_deletion_requests as request
  set
    continuation_attempt_count = request.continuation_attempt_count + 1,
    continuation_next_attempt_at = null,
    continuation_lease_until = clock_timestamp() + interval '3 minutes',
    updated_at = clock_timestamp()
  from candidates
  where request.user_id = candidates.user_id
    and request.client_request_id = candidates.client_request_id
  returning
    request.user_id,
    request.client_request_id,
    request.phase,
    request.continuation_attempt_count::integer;
end;
$$;

create or replace function public.release_account_deletion_continuation_claim(
  target_user_id uuid,
  target_client_request_id uuid,
  expected_attempt_count integer,
  outcome text,
  error_code text default null
)
returns table (
  accepted boolean,
  terminal boolean,
  next_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_outcome text := lower(btrim(outcome));
  backoff_seconds integer;
  released record;
begin
  if target_user_id is null
    or target_client_request_id is null
    or expected_attempt_count not between 1 and 8
    or normalized_outcome not in ('completed', 'resumable', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'ACCOUNT_DELETION_CONTINUATION_RELEASE_INVALID';
  end if;

  if normalized_outcome = 'failed' then
    if error_code is null or error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then
      raise exception using
        errcode = '22023',
        message = 'ACCOUNT_DELETION_CONTINUATION_ERROR_INVALID';
    end if;
  elsif error_code is not null then
    raise exception using
      errcode = '22023',
      message = 'ACCOUNT_DELETION_CONTINUATION_ERROR_UNEXPECTED';
  end if;

  backoff_seconds := least(
    (30 * power(2::numeric, greatest(expected_attempt_count - 1, 0)))::integer,
    3600
  );

  update private.account_deletion_requests as request
  set
    -- A successful bounded Storage chunk is progress, not a failed retry.
    -- Reset the consecutive-attempt budget so arbitrarily large accounts
    -- cannot become unclaimable merely because cleanup needed many chunks.
    continuation_attempt_count = case
      when normalized_outcome = 'resumable' then 0
      else request.continuation_attempt_count
    end,
    continuation_lease_until = null,
    continuation_next_attempt_at = case
      when normalized_outcome = 'resumable'
        then clock_timestamp() + interval '15 seconds'
      when normalized_outcome = 'failed' and expected_attempt_count < 8
        then clock_timestamp() + make_interval(secs => backoff_seconds)
      else null
    end,
    continuation_terminal_at = case
      when normalized_outcome = 'failed' and expected_attempt_count >= 8
        then coalesce(request.continuation_terminal_at, clock_timestamp())
      else null
    end,
    continuation_last_error_code = case
      when normalized_outcome = 'failed' then error_code
      else null
    end,
    continuation_last_error_at = case
      when normalized_outcome = 'failed' then clock_timestamp()
      else null
    end,
    updated_at = clock_timestamp()
  where request.user_id = target_user_id
    and request.client_request_id = target_client_request_id
    and request.continuation_attempt_count = expected_attempt_count
    and request.continuation_terminal_at is null
    and (
      (
        normalized_outcome = 'completed'
        and request.phase = 'completed'
      )
      or (
        normalized_outcome = 'resumable'
        and request.phase = 'storage_deleting'
        and request.continuation_lease_until is not null
      )
      or (
        normalized_outcome = 'failed'
        and request.phase in ('auth_deleted', 'storage_deleting')
        and request.continuation_lease_until is not null
      )
    )
  returning
    true as accepted,
    request.continuation_terminal_at is not null as terminal,
    request.continuation_next_attempt_at as next_attempt_at
  into released;

  if not found then
    return query select false, false, null::timestamptz;
    return;
  end if;

  return query select
    released.accepted,
    released.terminal,
    released.next_attempt_at;
end;
$$;

create or replace function public.list_terminal_account_deletion_continuations(
  requested_batch_size integer default 100
)
returns table (
  user_id uuid,
  client_request_id uuid,
  phase text,
  continuation_attempt_count integer,
  continuation_last_error_code text,
  continuation_last_error_at timestamptz,
  continuation_terminal_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(
    greatest(coalesce(requested_batch_size, 100), 1),
    500
  );
begin
  perform private.terminalize_expired_account_deletion_claims();

  return query
  select
    request.user_id,
    request.client_request_id,
    request.phase,
    request.continuation_attempt_count::integer,
    request.continuation_last_error_code,
    request.continuation_last_error_at,
    request.continuation_terminal_at
  from private.account_deletion_requests as request
  where request.phase in ('auth_deleted', 'storage_deleting')
    and request.continuation_terminal_at is not null
  order by request.continuation_terminal_at, request.client_request_id
  limit safe_batch_size;
end;
$$;

create or replace function private.account_deletion_worker_setting(secret_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select secret.decrypted_secret
  from vault.decrypted_secrets as secret
  where secret.name = secret_name
    and secret_name in (
      'edge_functions_base_url',
      'account_deletion_worker_secret'
    )
  order by secret.created_at desc
  limit 1;
$$;

create or replace function private.invoke_account_deletion_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_base_url text;
  worker_secret text;
  request_body jsonb := jsonb_build_object('drain', true, 'batchSize', 5);
  canonical_body text;
  request_timestamp bigint;
  request_nonce uuid;
  signature text;
  request_id bigint;
begin
  worker_base_url := private.account_deletion_worker_setting(
    'edge_functions_base_url'
  );
  worker_secret := private.account_deletion_worker_setting(
    'account_deletion_worker_secret'
  );

  if worker_base_url is null
    or worker_base_url !~ '^https://'
    or char_length(worker_base_url) > 500
    or char_length(coalesce(worker_secret, '')) < 32 then
    raise warning 'Account deletion worker Vault configuration is missing or invalid.';
    return null;
  end if;

  request_timestamp := floor(extract(epoch from clock_timestamp()))::bigint;
  request_nonce := gen_random_uuid();
  canonical_body := request_body::text;
  signature := encode(
    extensions.hmac(
      convert_to(
        request_timestamp::text || E'\n' ||
        request_nonce::text || E'\n' ||
        'delete-account-continuation' || E'\n' ||
        canonical_body,
        'UTF8'
      ),
      convert_to(worker_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  select net.http_post(
    url := rtrim(worker_base_url, '/') || '/delete-account',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-worker-timestamp', request_timestamp::text,
      'x-push-worker-nonce', request_nonce::text,
      'x-push-worker-signature', 'v1=' || signature
    ),
    body := request_body,
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.consume_account_deletion_worker_nonce(uuid, bigint)
from public, anon, authenticated;
revoke all on function public.claim_account_deletion_continuations(integer)
from public, anon, authenticated;
revoke all on function public.release_account_deletion_continuation_claim(
  uuid, uuid, integer, text, text
) from public, anon, authenticated;
revoke all on function public.list_terminal_account_deletion_continuations(integer)
from public, anon, authenticated;

grant execute on function public.consume_account_deletion_worker_nonce(uuid, bigint)
to service_role;
grant execute on function public.claim_account_deletion_continuations(integer)
to service_role;
grant execute on function public.release_account_deletion_continuation_claim(
  uuid, uuid, integer, text, text
) to service_role;
grant execute on function public.list_terminal_account_deletion_continuations(integer)
to service_role;

revoke all on function private.terminalize_expired_account_deletion_claims()
from public, anon, authenticated, service_role;
revoke all on function private.account_deletion_worker_setting(text)
from public, anon, authenticated, service_role;
revoke all on function private.invoke_account_deletion_worker()
from public, anon, authenticated, service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'etkinlink-account-deletion-continuations'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'etkinlink-account-deletion-continuations',
  '* * * * *',
  $job$
    select private.invoke_account_deletion_worker();
  $job$
);

comment on function public.claim_account_deletion_continuations(integer) is
  'Leases bounded Auth-deleted account cleanup requests with SKIP LOCKED; service-role only.';
comment on function public.release_account_deletion_continuation_claim(
  uuid, uuid, integer, text, text
) is
  'Compare-and-set release for completed, resumable, or failed account cleanup claims with bounded backoff and terminal state.';
comment on function public.list_terminal_account_deletion_continuations(integer) is
  'Service-only technical observability for account cleanup requests that exhausted automatic continuation.';

commit;
