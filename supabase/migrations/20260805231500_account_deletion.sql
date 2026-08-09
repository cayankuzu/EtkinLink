create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;

  update public.moderation_reports
  set reporter_user_id = null,
      details = '[Kullanıcı hesabını sildi]',
      client_context = '{}'::jsonb
  where reporter_user_id = current_user_id;

  update public.moderation_reports
  set target_user_id = null
  where target_user_id = current_user_id;

  delete from auth.users where id = current_user_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
