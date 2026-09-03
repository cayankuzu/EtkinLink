# Push incident ve credential rotation runbook

## Kapsam ve ilk karar

Şüpheli `PUSH_WORKER_SECRET`, `EXPO_ACCESS_TOKEN`, APNs key/certificate veya FCM service credential olayını provider audit aksini kanıtlayana kadar SEV-0 kabul et. Incident kanalına secret değeri, HMAC canonical body/signature, raw push token veya notification içeriği yapıştırma.

Current implementation tek aktif worker secret kabul eder. Güvenli overlap yoktur; bu yüzden Edge ve Vault değerleri değiştirilirken tüm DB çağıranlar durmalıdır. Domain write'ları durable outbox'ta birikebilir; outbox satırı silinmez.

## Containment

Protected production SQL oturumunda job tanımlarını kanıta al, sonra tek transaction içinde tam iki job'ı unschedule et ve yalnız push dispatch trigger'ını kapat:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname in ('etkinlink-push-outbox-drain', 'etkinlink-push-receipts')
order by jobname;

begin;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'etkinlink-push-outbox-drain',
      'etkinlink-push-receipts'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

alter table public.notification_events
  disable trigger notification_events_dispatch_push;

commit;

select count(*) as remaining_push_jobs
from cron.job
where jobname in ('etkinlink-push-outbox-drain', 'etkinlink-push-receipts');

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.notification_events'::regclass
  and tgname = 'notification_events_dispatch_push';
```

Doğrula: `remaining_push_jobs=0`, trigger `tgenabled='D'` durumunda, yeni domain eylemi yalnız `notification_events` outbox'ına yazılıyor. Title/body/payload seçme.

## Rotation sırası

1. Incident ID, ortam, SHA, credential **adı**, ilk/son şüpheli UTC zaman ve owner kaydet.
2. Worker secret etkilendiyse protected secret store üzerinden Edge `PUSH_WORKER_SECRET` değerini değiştir ve iki Function'ı approved SHA'dan deploy et. Ardından Vault `push_worker_secret` değerini aynı yeni değere çevir. Değeri CLI çıktısına veya shell history'ye yazma.
3. DB'den `private.invoke_push_worker` ile yeni body-bound HMAC üret; yeni çağrı 2xx olmalı. Yakalanmış eski/stale/wrong-scope/wrong-body/replay istekleri 401 olmalı.
4. Expo token etkilendiyse `EXPO_ACCESS_TOKEN` değerini iki Function ortamında değiştir; provider tarafında eski tokenı revoke et; bir sentetik ticket+receipt üret. Eski tokenın provider tarafından reddedildiğini kanıtla.
5. APNs/FCM credential etkilendiyse önce provider'da yenisini oluştur ve Expo projesine bağla, sentetik iki platform teslimini doğrula, sonra eskisini revoke et. Entitlement/profile/native signing değiştiyse yeni signed binary gerekir; OTA yeterli değildir.
6. Backlog yaşını, event/receipt attempt'lerini, terminal kodları ve invalid-token cleanup'ı gözle. Secret veya notification içeriği loglama.

Function deploy komutları secret değerini içermez:

```powershell
npx supabase@2.115.0 secrets list --project-ref <PROJECT_REF>
npx supabase@2.115.0 functions deploy push-dispatch --project-ref <PROJECT_REF>
npx supabase@2.115.0 functions deploy push-receipts --project-ref <PROJECT_REF>
```

## Kontrollü yeniden açma

Reviewed migration komutlarını exact olarak yeniden oluştur:

```sql
begin;

select cron.schedule(
  'etkinlink-push-outbox-drain',
  '* * * * *',
  $job$
    select private.invoke_push_worker(
      'push-dispatch',
      jsonb_build_object('drain', true, 'batchSize', 20)
    );
  $job$
);

select cron.schedule(
  'etkinlink-push-receipts',
  '*/5 * * * *',
  $job$
    select private.invoke_push_worker('push-receipts', '{}'::jsonb);
  $job$
);

commit;
```

İki job adından tam birer tane bulunduğunu doğrula; count farklıysa job'ları yeniden durdur ve trigger'ı kapalı tut. Doğruysa trigger'ı ayrı adımda aç:

```sql
select jobname, count(*)
from cron.job
where jobname in ('etkinlink-push-outbox-drain', 'etkinlink-push-receipts')
group by jobname
order by jobname;

alter table public.notification_events
  enable trigger notification_events_dispatch_push;
```

Normal concurrency ile drain et; elle attempt/lease değiştirme. Yeni sentetik event → ticket → receipt terminal zinciri ve iki fiziksel platform teslimi başarılı olmadan incident'i kapatma.

## Rollback

Doğrulama başarısızsa caller'ları kapalı tut. Compromised credential'a dönme. Son bilinen iyi, non-compromised credential çifti varsa Edge+Vault'a birlikte geri koy ve aynı kontrolleri tekrarla; yoksa deny-by-default Function deploy et. Son uyumlu Function SHA'sına dönülebilir, fakat forward-only DB migration geri alınmaz ve lease'siz eski Function deploy edilmez. Outbox, attempt ve audit kayıtları korunur.

## Kanıt ve NO-GO

Kanıt yolu `artifacts/incidents/<incident-id>/push/`. Redacted pre/post secret **adları**, provider revoke/rotation ID'si, SHA/deploy ID, job/trigger before-after, eski credential reddi, yeni HMAC sonucu, sentetik ticket+receipt, backlog aggregate, fiziksel cihaz sonucu, UTC timeline, owner ve iki reviewer içerir.

Old credential rejection, yeni DB-generated HMAC, provider ticket+receipt, job tekilliği, trigger durumu ve Android+iOS sentetik teslim aynı approved SHA'da kanıtlanmadıysa yeniden açma ve release **NO-GO**.
