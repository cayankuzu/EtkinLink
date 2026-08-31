begin;

create or replace function public.ingest_events_batch(event_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_size integer;
begin
  if event_rows is null or jsonb_typeof(event_rows) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Event ingestion payload must be a JSON array.';
  end if;

  batch_size := jsonb_array_length(event_rows);
  if batch_size not between 1 and 200 then
    raise exception using
      errcode = '22023',
      message = 'Event ingestion batch must contain 1-200 rows.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(event_rows) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every event ingestion row must be a JSON object.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(event_rows) as item(value)
    cross join lateral jsonb_to_record(item.value) as parsed(external_id bigint)
    where parsed.external_id is null or parsed.external_id <= 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'Every event ingestion row must have a positive external_id.';
  end if;

  -- A single production scheduler owns ingestion. The transaction-scoped lock
  -- also serializes accidental overlapping invocations without external state.
  perform pg_advisory_xact_lock(
    hashtextextended('etkinlink:event-ingestion', 0)
  );

  with parsed_events as (
    select
      item.ordinality,
      parsed.external_id,
      parsed.source_guid,
      parsed.source_url,
      parsed.title,
      parsed.summary,
      parsed.description,
      parsed.start_at,
      parsed.end_at,
      parsed.venue,
      parsed.city,
      parsed.district,
      parsed.address,
      parsed.image_url,
      parsed.categories,
      parsed.source_updated_at,
      parsed.is_cancelled,
      parsed.raw_source,
      parsed.ingested_at
    from jsonb_array_elements(event_rows) with ordinality as item(value, ordinality)
    cross join lateral jsonb_to_record(item.value) as parsed(
      external_id bigint,
      source_guid text,
      source_url text,
      title text,
      summary text,
      description text,
      start_at timestamptz,
      end_at timestamptz,
      venue text,
      city text,
      district text,
      address text,
      image_url text,
      categories text[],
      source_updated_at timestamptz,
      is_cancelled boolean,
      raw_source jsonb,
      ingested_at timestamptz
    )
  ),
  deduplicated_events as (
    select distinct on (external_id)
      external_id,
      source_guid,
      source_url,
      title,
      summary,
      description,
      start_at,
      end_at,
      venue,
      city,
      district,
      address,
      image_url,
      categories,
      source_updated_at,
      is_cancelled,
      raw_source,
      ingested_at
    from parsed_events
    order by external_id, ordinality desc
  )
    insert into public.events as stored_event (
      external_id,
      source_guid,
      source_url,
      title,
      summary,
      description,
      start_at,
      end_at,
      venue,
      city,
      district,
      address,
      image_url,
      categories,
      source_updated_at,
      is_cancelled,
      raw_source,
      ingested_at
    )
    select
      external_id,
      source_guid,
      source_url,
      title,
      summary,
      description,
      start_at,
      end_at,
      venue,
      city,
      district,
      address,
      image_url,
      categories,
      source_updated_at,
      is_cancelled,
      raw_source,
      ingested_at
    from deduplicated_events
    on conflict (external_id) do update set
      source_guid = excluded.source_guid,
      source_url = excluded.source_url,
      title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      venue = excluded.venue,
      city = excluded.city,
      district = excluded.district,
      address = excluded.address,
      image_url = excluded.image_url,
      categories = excluded.categories,
      source_updated_at = excluded.source_updated_at,
      is_cancelled = excluded.is_cancelled,
      raw_source = excluded.raw_source,
      ingested_at = excluded.ingested_at
    -- Prefer the provider's version when present. The Edge Function captures
    -- ingested_at once before fetching, so it is a monotonic run-version
    -- fallback for providers that omit source_updated_at. This prevents an
    -- older overlapping run from overwriting a newer committed snapshot.
    where coalesce(
      excluded.source_updated_at,
      excluded.ingested_at
    ) >= coalesce(
      stored_event.source_updated_at,
      stored_event.ingested_at
    );

  -- Stale rows intentionally skipped by the conflict guard are still valid,
  -- fully processed input. Preserve the RPC's batch-size contract so callers
  -- do not treat a safe no-op as a partial-write failure.
  return batch_size;
end;
$$;

revoke all on function public.ingest_events_batch(jsonb) from public;
revoke all on function public.ingest_events_batch(jsonb) from anon, authenticated;
grant execute on function public.ingest_events_batch(jsonb) to service_role;

commit;
