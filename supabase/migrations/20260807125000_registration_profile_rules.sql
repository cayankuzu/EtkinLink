begin;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format check (
    username is null
    or (
      username::text ~ '^[a-z0-9][a-z0-9_]{1,22}[a-z0-9]$'
      and username::text !~ '__'
      and username::text not in (
        'admin', 'administrator', 'moderator', 'etkinlink', 'support',
        'destek', 'system', 'sistem', 'official', 'resmi', 'root',
        'api', 'null', 'undefined', 'test', 'guest'
      )
    )
  ) not valid;

alter table public.profiles
  drop constraint if exists profiles_bio_length;

alter table public.profiles
  add constraint profiles_bio_length check (
    bio is null or char_length(btrim(bio)) between 1 and 300
  );

create or replace function public.is_username_available(candidate_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with candidate as (
    select lower(btrim(coalesce(candidate_username, ''))) as value
  )
  select
    char_length(candidate.value) between 3 and 24
    and candidate.value ~ '^[a-z0-9][a-z0-9_]{1,22}[a-z0-9]$'
    and candidate.value !~ '__'
    and candidate.value not in (
      'admin', 'administrator', 'moderator', 'etkinlink', 'support',
      'destek', 'system', 'sistem', 'official', 'resmi', 'root',
      'api', 'null', 'undefined', 'test', 'guest'
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.username = candidate.value::extensions.citext
        and (auth.uid() is null or profile.id <> auth.uid())
    )
  from candidate;
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function private.is_profile_ready(candidate_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = candidate_id
      and profile.email_verified
      and profile.account_disabled_at is null
      and profile.full_name is not null
      and profile.username is not null
      and profile.birth_date is not null
      and profile.gender is not null
      and profile.city is not null
      and (select count(*) from public.profile_photos photo where photo.user_id = profile.id) between 3 and 6
      and (select count(*) from public.user_interests interest where interest.user_id = profile.id) between 3 and 12
  );
$$;

create or replace function public.complete_onboarding()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  result public.profiles;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Oturum gerekli.';
  end if;
  if not private.is_profile_ready(current_user_id) then
    raise exception using errcode = '23514', message = 'Profil için ad, kullanıcı adı, doğum tarihi, cinsiyet, şehir, en az 3 fotoğraf ve en az 3 ilgi alanı gerekir.';
  end if;
  update public.profiles
  set onboarding_completed = true, updated_at = now()
  where id = current_user_id
  returning * into result;
  return result;
end;
$$;

revoke all on function public.complete_onboarding() from public;
grant execute on function public.complete_onboarding() to authenticated;

insert into public.interests (slug, label, sort_order, is_active)
values
  ('canli-muzik', 'Canlı Müzik', 10, true),
  ('konser', 'Konser', 20, true),
  ('festival', 'Festival', 30, true),
  ('elektronik-muzik', 'Elektronik Müzik', 40, true),
  ('klasik-muzik', 'Klasik Müzik', 50, true),
  ('caz', 'Caz', 60, true),
  ('rock', 'Rock', 70, true),
  ('metal', 'Metal', 80, true),
  ('hip-hop', 'Hip-Hop', 90, true),
  ('indie', 'Indie', 100, true),
  ('alternatif-muzik', 'Alternatif Müzik', 110, true),
  ('halk-muzigi', 'Halk Müziği', 120, true),
  ('opera', 'Opera', 130, true),
  ('muzikal', 'Müzikal', 140, true),
  ('tiyatro', 'Tiyatro', 150, true),
  ('stand-up', 'Stand-up', 160, true),
  ('sinema', 'Sinema', 170, true),
  ('sergi', 'Sergi', 180, true),
  ('muze', 'Müze', 190, true),
  ('dijital-sanat', 'Dijital Sanat', 200, true),
  ('resim', 'Resim', 210, true),
  ('heykel', 'Heykel', 220, true),
  ('tasarim', 'Tasarım', 230, true),
  ('fotograf', 'Fotoğraf', 240, true),
  ('mimari', 'Mimari', 250, true),
  ('edebiyat', 'Edebiyat', 260, true),
  ('kitap', 'Kitap', 270, true),
  ('cizgi-roman', 'Çizgi Roman', 280, true),
  ('soylesi', 'Söyleşi', 290, true),
  ('atolye', 'Atölye', 300, true),
  ('el-sanatlari', 'El Sanatları', 310, true),
  ('dans', 'Dans', 320, true),
  ('bale', 'Bale', 330, true),
  ('teknoloji', 'Teknoloji', 340, true),
  ('yapay-zeka', 'Yapay Zekâ', 350, true),
  ('yazilim', 'Yazılım', 360, true),
  ('mobil-teknoloji', 'Mobil Teknoloji', 370, true),
  ('robotik', 'Robotik', 380, true),
  ('bilim', 'Bilim', 390, true),
  ('uzay', 'Uzay', 400, true),
  ('matematik', 'Matematik', 410, true),
  ('girisimcilik', 'Girişimcilik', 420, true),
  ('kariyer', 'Kariyer', 430, true),
  ('finans', 'Finans', 440, true),
  ('networking', 'Networking', 450, true),
  ('egitim', 'Eğitim', 460, true),
  ('psikoloji', 'Psikoloji', 470, true),
  ('felsefe', 'Felsefe', 480, true),
  ('sosyoloji', 'Sosyoloji', 490, true),
  ('kisisel-gelisim', 'Kişisel Gelişim', 500, true),
  ('dil-degisimi', 'Dil Değişimi', 510, true),
  ('oyun', 'Oyun', 520, true),
  ('masa-oyunlari', 'Masa Oyunları', 530, true),
  ('e-spor', 'E-spor', 540, true),
  ('spor', 'Spor', 550, true),
  ('kosu', 'Koşu', 560, true),
  ('bisiklet', 'Bisiklet', 570, true),
  ('yuzme', 'Yüzme', 580, true),
  ('fitness', 'Fitness', 590, true),
  ('futbol', 'Futbol', 600, true),
  ('basketbol', 'Basketbol', 610, true),
  ('tenis', 'Tenis', 620, true),
  ('trekking', 'Trekking', 630, true),
  ('kamp', 'Kamp', 640, true),
  ('doga', 'Doğa', 650, true),
  ('seyahat', 'Seyahat', 660, true),
  ('yoga', 'Yoga', 670, true),
  ('wellness', 'Wellness', 680, true),
  ('meditasyon', 'Meditasyon', 690, true),
  ('gastronomi', 'Gastronomi', 700, true),
  ('kahve', 'Kahve', 710, true),
  ('sokak-lezzetleri', 'Sokak Lezzetleri', 720, true),
  ('vegan', 'Vegan', 730, true),
  ('kokteyl', 'Kokteyl', 740, true),
  ('sarap', 'Şarap', 750, true),
  ('moda', 'Moda', 760, true),
  ('surdurulebilirlik', 'Sürdürülebilirlik', 770, true),
  ('gonulluluk', 'Gönüllülük', 780, true),
  ('sosyal-sorumluluk', 'Sosyal Sorumluluk', 790, true),
  ('hayvan-haklari', 'Hayvan Hakları', 800, true),
  ('tarih', 'Tarih', 810, true)
on conflict (slug) do update set
  label = excluded.label,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

commit;
