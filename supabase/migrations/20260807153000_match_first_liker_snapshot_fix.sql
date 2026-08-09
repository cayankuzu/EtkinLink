begin;

create or replace function private.capture_match_compatibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot jsonb;
  first_liker_id uuid;
begin
  if tg_op = 'INSERT'
    or (
      new.status = 'active'
      and (
        old.status is distinct from 'active'
        or old.accepted_by_user_id is distinct from new.accepted_by_user_id
      )
    ) then
    select event_like.user_id into first_liker_id
    from public.event_likes as event_like
    where event_like.event_id = new.event_id
      and (
        (event_like.user_id = new.user1_id and event_like.liked_user_id = new.user2_id)
        or
        (event_like.user_id = new.user2_id and event_like.liked_user_id = new.user1_id)
      )
    order by event_like.created_at, event_like.user_id
    limit 1;

    new.first_like_by_user_id := coalesce(first_liker_id, new.first_like_by_user_id);
    snapshot := private.calculate_compatibility(new.user1_id, new.user2_id);
    new.matched_at := now();
    new.compatibility_score := coalesce((snapshot ->> 'score')::smallint, 0);
    new.compatibility_snapshot := snapshot;
  end if;
  return new;
end;
$$;

commit;
