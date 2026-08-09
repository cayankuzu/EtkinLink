delete from public.events
where raw_source ->> 'provider' = 'etkinlik.io'
  and image_url is null;

alter table public.events
  drop constraint if exists events_provider_image_required;

alter table public.events
  add constraint events_provider_image_required check (
    raw_source ->> 'provider' <> 'etkinlik.io' or image_url is not null
  );
