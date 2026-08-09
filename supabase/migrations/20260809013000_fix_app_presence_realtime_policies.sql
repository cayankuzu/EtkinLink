begin;

-- Realtime performs private-channel authorization as the authenticated role.
-- EtkinLink intentionally revokes USAGE on the private schema, so topic checks
-- must stay inline instead of calling private parsing helpers.
drop policy if exists "users receive authorized app presence" on realtime.messages;
create policy "users receive authorized app presence"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) = 'presence:' || (select auth.uid())::text
  or (
    (select realtime.topic()) ~ '^presence:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.matches as match
      where match.status = 'active'
        and (
          (
            match.user1_id = (select auth.uid())
            and match.user2_id::text = split_part((select realtime.topic()), ':', 2)
          )
          or (
            match.user2_id = (select auth.uid())
            and match.user1_id::text = split_part((select realtime.topic()), ':', 2)
          )
        )
    )
  )
);

drop policy if exists "users publish only their app presence" on realtime.messages;
create policy "users publish only their app presence"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.topic()) = 'presence:' || (select auth.uid())::text
);

drop policy if exists "active matches receive pair typing" on realtime.messages;
create policy "active matches receive pair typing"
on realtime.messages
for select
to authenticated
using (
  (select realtime.topic()) ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
    or split_part((select realtime.topic()), ':', 3) = (select auth.uid())::text
  )
  and exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and match.user1_id::text = least(
        split_part((select realtime.topic()), ':', 2),
        split_part((select realtime.topic()), ':', 3)
      )
      and match.user2_id::text = greatest(
        split_part((select realtime.topic()), ':', 2),
        split_part((select realtime.topic()), ':', 3)
      )
  )
);

drop policy if exists "active matches publish pair typing" on realtime.messages;
create policy "active matches publish pair typing"
on realtime.messages
for insert
to authenticated
with check (
  (select realtime.topic()) ~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (
    split_part((select realtime.topic()), ':', 2) = (select auth.uid())::text
    or split_part((select realtime.topic()), ':', 3) = (select auth.uid())::text
  )
  and exists (
    select 1
    from public.matches as match
    where match.status = 'active'
      and match.user1_id::text = least(
        split_part((select realtime.topic()), ':', 2),
        split_part((select realtime.topic()), ':', 3)
      )
      and match.user2_id::text = greatest(
        split_part((select realtime.topic()), ':', 2),
        split_part((select realtime.topic()), ':', 3)
      )
  )
);

commit;
