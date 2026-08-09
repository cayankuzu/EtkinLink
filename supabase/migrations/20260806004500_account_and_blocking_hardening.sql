alter table public.moderation_reports
  alter column reporter_user_id drop not null,
  alter column target_user_id drop not null;

alter table public.moderation_reports
  drop constraint if exists moderation_reports_reporter_user_id_fkey,
  drop constraint if exists moderation_reports_target_user_id_fkey;

alter table public.moderation_reports
  add constraint moderation_reports_reporter_user_id_fkey
    foreign key (reporter_user_id) references public.profiles(id) on delete set null,
  add constraint moderation_reports_target_user_id_fkey
    foreign key (target_user_id) references public.profiles(id) on delete set null;

create or replace function private.anonymize_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.moderation_reports
  set
    reporter_user_id = case when reporter_user_id = old.id then null else reporter_user_id end,
    target_user_id = case when target_user_id = old.id then null else target_user_id end,
    details = case
      when reporter_user_id = old.id then '[Silinen hesaba ait rapor içeriği anonimleştirildi]'
      else details
    end,
    context_snapshot = case
      when reporter_user_id = old.id or target_user_id = old.id then '{}'::jsonb
      else context_snapshot
    end,
    client_context = case
      when reporter_user_id = old.id then '{}'::jsonb
      else client_context
    end
  where reporter_user_id = old.id or target_user_id = old.id;
  return old;
end;
$$;

drop trigger if exists profiles_anonymize_before_delete on public.profiles;
create trigger profiles_anonymize_before_delete
before delete on public.profiles
for each row execute function private.anonymize_deleted_profile();

drop function if exists public.delete_my_account();

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if current_user_id = target_user_id then
    raise exception using errcode = '23514', message = 'Kendini engelleyemezsin.';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.id = target_user_id and profile.account_disabled_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'Kullanıcı bulunamadı.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, target_user_id)::text || ':' || greatest(current_user_id, target_user_id)::text,
      0
    )
  );

  insert into public.user_blocks (blocker_id, blocked_id)
  values (current_user_id, target_user_id)
  on conflict do nothing;
  get diagnostics changed = row_count;
  if changed = 0 then return; end if;

  delete from public.event_likes
  where (user_id = current_user_id and liked_user_id = target_user_id)
     or (user_id = target_user_id and liked_user_id = current_user_id);

  update public.matches
  set status = 'blocked', updated_at = now()
  where user1_id = least(current_user_id, target_user_id)
    and user2_id = greatest(current_user_id, target_user_id);

  insert into public.notification_events (user_id, actor_user_id, kind, title, body)
  values (
    target_user_id,
    current_user_id,
    'blocked',
    'Bir kullanıcı seni engelledi',
    'Karşılıklı keşif ve mesajlaşma erişimi kapatıldı.'
  );
end;
$$;

create or replace function public.unblock_user(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  changed integer;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      least(current_user_id, target_user_id)::text || ':' || greatest(current_user_id, target_user_id)::text,
      0
    )
  );

  delete from public.user_blocks
  where blocker_id = current_user_id and blocked_id = target_user_id;
  get diagnostics changed = row_count;
  if changed = 0 then return; end if;

  update public.matches as match
  set
    status = 'ended',
    ended_at = coalesce(match.ended_at, now()),
    updated_at = now()
  where match.user1_id = least(current_user_id, target_user_id)
    and match.user2_id = greatest(current_user_id, target_user_id)
    and not private.is_blocked(current_user_id, target_user_id)
    and match.status = 'blocked';

  insert into public.notification_events (user_id, actor_user_id, kind, title, body)
  values (
    target_user_id,
    current_user_id,
    'unblocked',
    'Engel kaldırıldı',
    'Önceki eşleşme otomatik olarak yeniden açılmadı.'
  );
end;
$$;

create or replace function public.list_blocked_users()
returns table (
  id uuid,
  full_name text,
  username text,
  primary_photo_path text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    profile.id,
    profile.full_name,
    profile.username::text,
    photo.storage_path,
    block.created_at
  from public.user_blocks as block
  join public.profiles as profile on profile.id = block.blocked_id
  left join public.profile_photos as photo
    on photo.user_id = profile.id and photo.position = 0
  where block.blocker_id = auth.uid()
  order by block.created_at desc, profile.id;
$$;

drop policy if exists profile_photo_storage_select on storage.objects;
create policy profile_photo_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'profile-photos'
  and exists (
    select 1
    from public.profile_photos as photo
    join public.profiles as profile on profile.id = photo.user_id
    where photo.storage_path = name
      and (
        photo.user_id = auth.uid()
        or exists (
          select 1 from public.user_blocks as block
          where block.blocker_id = auth.uid() and block.blocked_id = profile.id
        )
        or (
          profile.account_disabled_at is null
          and profile.onboarding_completed
          and not private.is_blocked(auth.uid(), profile.id)
        )
      )
  )
);

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.list_blocked_users() from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.list_blocked_users() to authenticated;
