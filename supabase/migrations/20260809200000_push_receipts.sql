begin;

alter table public.notification_deliveries
  add column if not exists receipt_status text,
  add column if not exists receipt_checked_at timestamptz,
  add column if not exists receipt_error_code text;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_receipt_status_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_receipt_status_check
  check (receipt_status is null or receipt_status in ('delivered', 'failed'));

create index if not exists idx_notification_deliveries_pending_receipts
  on public.notification_deliveries (created_at, id)
  where status = 'sent' and expo_ticket_id is not null and receipt_checked_at is null;

commit;
