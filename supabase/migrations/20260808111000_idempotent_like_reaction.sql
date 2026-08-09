begin;

create or replace function public.change_event_like_to_pass(
  target_event_id uuid,
  target_user_id uuid,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_id uuid := request_id;
  request_hash text;
  previous private.idempotency_records;
  quota public.swipe_quotas;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  request_hash := encode(
    extensions.digest(target_event_id::text || ':' || target_user_id::text, 'sha256'),
    'hex'
  );
  select record.* into previous
  from private.idempotency_records as record
  where record.user_id = current_user_id
    and record.operation = 'change_event_like_to_pass'
    and record.request_id = requested_id;
  if found then
    if previous.payload_hash <> request_hash then
      raise exception using
        errcode = '22023',
        message = 'Aynı işlem anahtarı farklı veriyle kullanılamaz.';
    end if;
    return previous.response;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_event_id::text || least(current_user_id, target_user_id)::text || greatest(current_user_id, target_user_id)::text,
      0
    )
  );

  if not exists (
    select 1 from public.event_likes
    where event_id = target_event_id
      and user_id = current_user_id
      and liked_user_id = target_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Beğeni bulunamadı.';
  end if;
  if exists (
    select 1 from public.matches as match
    where match.event_id = target_event_id
      and match.status = 'active'
      and match.user1_id = least(current_user_id, target_user_id)
      and match.user2_id = greatest(current_user_id, target_user_id)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Aktif eşleşmeyi Mesajlar alanından yönetebilirsin.';
  end if;

  quota := private.consume_swipe_quota(current_user_id, 'pass');
  delete from public.event_likes
  where event_id = target_event_id
    and user_id = current_user_id
    and liked_user_id = target_user_id;
  insert into public.event_passes (event_id, user_id, passed_user_id)
  values (target_event_id, current_user_id, target_user_id)
  on conflict do nothing;

  result := jsonb_build_object(
    'status', 'passed',
    'quota', private.swipe_quota_payload(quota)
  );
  insert into private.idempotency_records (
    user_id, operation, request_id, payload_hash, response
  ) values (
    current_user_id,
    'change_event_like_to_pass',
    requested_id,
    request_hash,
    result
  );
  return result;
end;
$$;

commit;
