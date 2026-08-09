# Etkinlik.io V2 API entegrasyonu

Bu proje Etkinlik.io'nun resmî V2 REST API'sini kullanır. Mobil uygulama React
Native olduğu için resmî Dart/Flutter paketi doğrudan kullanılmaz; aynı OpenAPI
sözleşmesi Supabase Edge Functions üzerinden çağrılır. Böylece yayıncı token'ı
APK/IPA içine girmez.

## Resmî sözleşme

- Taban URL: `https://etkinlik.io/api/v2`
- Kimlik doğrulama: her istekte `X-Etkinlik-Token` HTTP başlığı
- Güncel API/SDK sürümü: `2.0.11`
- Liste sayfalaması: `skip` + `take`; varsayılan `take=50`
- Liste yanıtı: `{ meta: { total_count }, items: Event[] }`
- Yeni entegrasyonlarda zaman alanları: UTC anı için `start_r001` ve
  `end_r001`, sunum için IANA `timezone`
- `start`/`end` ve eski `venue` alanları geriye uyumluluk için vardır; yeni
  entegrasyonlarda kullanılmamalıdır.

Desteklenen ana uç noktalar:

| İstek | Amaç |
| --- | --- |
| `GET /events` | Etkinlik listesi ve filtreleme |
| `GET /events/{id}` | Etkinlik detayı |
| `POST /events/{id}/impressions` | Gösterim kaydı |
| `GET /categories` | Kategori kataloğu |
| `GET /formats` | Etkinlik türü/format kataloğu |
| `GET /cities` | Şehir kataloğu |
| `GET /cities/{id}/districts` | Şehrin ilçeleri |
| `GET /districts/{id}/neighborhoods` | İlçenin mahalleleri |
| `GET /venues` / `GET /venues/{id}` | Mekân listesi ve detayı |

`GET /events` filtreleri:

- `format_ids`, `category_ids`, `venue_ids`, `city_ids`: virgülle ayrılmış ID
- `start_gte`, `end_lte`: `YYYY-MM-DD HH:mm:ss`
- `sort_by`: `upcoming`, `recent` veya `updated`
- `skip`, `take`: offset sayfalama

`updated`, içerik veya kaynak verisi en son değişen kayıtları döndürür ve arka
plan senkronizasyonu için uygundur. `recent`, kataloğa yakın zamanda onaylanan
kayıtları; `upcoming` ise başlangıç zamanı yaklaşan kayıtları döndürür.

## EtkinLink veri akışı

1. Mobil istemci yalnızca oturum JWT'siyle `etkinlik-api` Edge Function'ını
   çağırır.
2. Function, kullanıcı oturumunu doğrular ve yayıncı token'ını
   `ETKINLIK_IO_API_TOKEN` secret'ından okur.
3. Şehir/format adları resmî katalogdaki sayısal ID'lere çevrilir.
4. Etkinlik alanları ortak mobil `Event` modeline dönüştürülür.
5. Katılım, kaydetme ve oda işlemi gerektiğinde `sync-event`, kaydı PostgreSQL'e
   güvenli biçimde upsert eder.
6. `ingest-events`, `sort_by=updated` ile yaklaşan etkinlikleri toplu olarak
   günceller. Bu uç nokta ayrıca bağımsız `INGEST_CRON_SECRET` ile korunur.
7. Resmî API geçici olarak kullanılamazsa keşfet akışı mevcut RSS kaynağına
   düşer; token hiçbir zaman RSS URL'sine veya mobil istemciye taşınmaz.

Edge Function katmanında kataloglar 6 saat, aynı API yanıtları 2 dakika bellekte
önbelleklenir. İstekler 12–15 saniyede zaman aşımına uğrar; `429` istemciye ayrı
aktarılır. URL alanlarında yalnızca HTTPS kabul edilir ve HTML açıklamalar düz
metne çevrilir.

## Alan eşlemesi

| Etkinlik.io | EtkinLink |
| --- | --- |
| `id` | `external_id`; istemcide `etkinlik-io-{id}` |
| `name` | `title` |
| `content` | `description` ve 500 karakterlik `summary` |
| `start_r001` / `end_r001` | `start_at` / `end_at` |
| `modified_at` | `source_updated_at` |
| `poster_url` | `image_url` |
| `url` | `source_url` ve benzersiz `source_guid` |
| `ticket_url` | detay ekranındaki bilet bağlantısı |
| `format`, `category`, `tags` | `categories[]` |
| `venue_type`, `venue_data` | mekân, şehir, ilçe ve adres |
| `is_free` | ücretsiz erişim bilgisi |

`venue_type` için üç durum işlenir: `VENUE` kayıtlı mekân nesnesi, `MANUAL`
serbest girilmiş mekân/şehir/ilçe alanları, `ONLINE` ise çevrim içi etkinlik.

## Secret ve dağıtım

Gerçek token hiçbir `.env`, TypeScript veya mobil yapılandırma dosyasına
yazılmamalıdır. Bağlı Supabase projesinde değer şu adla saklanır:

```powershell
npx supabase secrets set ETKINLIK_IO_API_TOKEN=<YAYINCI_TOKENI>
```

Function dağıtımı:

```powershell
npx supabase functions deploy etkinlik-api --no-verify-jwt
npx supabase functions deploy sync-event --no-verify-jwt
npx supabase functions deploy ingest-events --no-verify-jwt
```

`--no-verify-jwt`, function'ın açık olduğu anlamına gelmez: `etkinlik-api` ve
`sync-event` JWT'yi function içinde Supabase Auth ile doğrular; `ingest-events`
ise zamanlayıcı secret'ını sabit zamanlı karşılaştırmayla doğrular.

## İşletim kontrol listesi

- API sağlık panelinde kota, `401/403`, `429` ve `5xx` oranlarını izle.
- `ETKINLIK_IO_API_TOKEN` yalnızca Edge Function secret store'da bulunsun.
- Senkronizasyonu küçük sayfalarda çalıştır; mevcut worker tek çalışmada en çok
  200 etkinliği işler.
- `modified_at` ve `sort_by=updated` ile değişiklikleri yakala.
- İptal/silme sinyalleri için sağlık paneli ve API hata modelini izleyip
  `is_cancelled` güncellemesini ayrı bir bakım işi olarak ele al.
- Token sohbet, ekran görüntüsü veya terminal geçmişinde paylaşıldıysa yayın
  öncesi yenile ve Supabase secret'ını yeni değerle değiştir.

## Resmî kaynaklar

- Geliştirici rehberi: <https://etkinlik.io/api-bilgi>
- OpenAPI referansı: <https://api-docs.etkinlik.io/>
- Resmî Dart SDK ve üretilmiş model belgeleri:
  <https://github.com/etkinlik/dart-sdk>
- Doğrulanmış pub.dev paketi: <https://pub.dev/packages/etkinlik_io_api>
