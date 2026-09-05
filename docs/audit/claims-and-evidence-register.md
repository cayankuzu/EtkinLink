# EtkinLink — Teknik İddia ve Kanıt Kütüğü

Bu dosya **teknik** kalite iddialarını kanıtına bağlar.
Pazarlama iddiaları ayrıdır: `docs/marketing/claims-register.md`.

**Kural:** Bir iddia ancak (a) onu üreten komut, (b) komutun çalıştığı SHA ve
(c) sonucu yazılıysa bu dosyada durabilir. "Geçti" yazan bir rapor kanıt
değildir; kanıt, komutun kendisidir. Yerel sonuç uzak CI sonucu yerine
geçmez, uzak CI sonucu da cihaz/sağlayıcı kanıtı yerine geçmez.

**Aday dal:** `chore/final-release-candidate-aaa`
**Uzak CI kanıtı:** `b03afee` (Docker 5/5), `36a3e105` (Mobil 7/7)
**Baz alınan main SHA:** `638742bb`
**Son güncelleme:** 2026-09-05

---

## 0. Kanıt seviyeleri

| Seviye | Anlamı | Bu sürümde |
|---|---|---|
| L1 — yerel | Komut bu makinede çalıştı | Var |
| L2 — uzak CI | Aynı SHA'da GitHub Actions çalıştı | PR #1 ile tetiklendi |
| L3 — çalışma zamanı | Gerçek cihaz / gerçek sağlayıcı | **Yok** |
| L4 — mağaza | TestFlight / Internal Track | **Yok** |

L3 ve L4 olmadan yayın kararı `GO` olamaz.

---

## 1. Kapatılan kırmızılar (main @ `638742bb` → aday @ `36a3e105`)

Üçü de değiştirilmeden **önce** yerelde yeniden üretildi.

| # | Uzak CI hatası | Yerel yeniden üretim | Kök neden | Çözüm |
|---|---|---|---|---|
| P0-1 | `secret-scan`: `generic-api-key`, `telemetry.test.ts:52`, fingerprint `6c91cd42…:generic-api-key:52` | `gitleaks detect` aynı fingerprint'i verdi | Redaksiyon fixture'ı `?token=eyJ…` biçiminde yazılmıştı; tarayıcı bunu kimlik bilgisi okur | Fixture `{"alg":"none"}` / `{"sub":"x"}` çözülen, üçüncü parçası düz kelime olan sentetik işaretçiye çevrildi ve interpolasyonla yazıldı. Tarih kaydı için tek commit-kapsamlı fingerprint |
| P0-2 | `docker-test`: `Unsafe evidence rejected (supabase-key): artifacts/docker/test/supabase-start.txt` | `supabase start` çıktısı yerelde alındı; ham çıktıda 4 sınıf kimlik bilgisi | Ham çıktı regex'e güveniyordu; CLI biçimi değişince sızıntı kaçınılmaz | `summarizeSupabaseStart`: yalnız kanıt taşıyan satırlar tutulur, durum yükü alan **adlarına** indirgenir, düşen satır sayılır |
| P0-3 | `compose-build-security`: `a19533ef…` ≠ `e6935244…` | Yerelde iki temiz-önbellek build: `13fb52dd…` ≠ `ea7d0dd3…` | `SOURCE_DATE_EPOCH` yalnız config `created` ve history damgalarını sabitler; katman içi dosya mtime'ları duvar saatinden gelir, `npm ci` her seferinde farklı diffID üretir | Dışa aktarımda `rewrite-timestamp=true`; karşılaştırma daemon image ID'si yerine OCI manifest/config digest + diffID + label üzerinden |

**P0-2 ek bulgu:** `database-security` job'ı `supabase db start` çıktısını hiçbir
sanitizasyondan geçirmeden artifact'a yazıyordu. Artık özet yazılır ve yükleme
öncesi kanıt sır taraması koşar.

**P0-3 ek bulgu:** Provenance kontrolü sessizce bozuktu — üst düzey index'in
`manifests` dizisine bakıyordu, oysa provenance build bir seviye daha iç içe
index üretir; ne imaj ne attestation orada bulunur.

---

## 2. Yerelde ölçülmüş iddialar (L1)

| İddia | Komut | Sonuç |
|---|---|---|
| Kod tabanı tam denetlendi | `npm run audit:manifest` | 554 izlenen dosya, 501 incelenen, 81.025 satır, 0 okunamayan, 0 risk sinyali |
| Ürün yüzeyi değişmedi | `npm run feature-freeze` | 5 sekme, 43 route, 39 ekran, 26 public tablo |
| Ekran durum sözleşmesi | `npm run screen-state:guards` | 39 ekran, 25'i veri çeker, 0 boşluk |
| Dokunma hedefleri | `npm run touch-target:guards` | 74 dosyadaki ölçülebilir kontrol ≥ 48dp |
| Birim/entegrasyon testleri | `npm run verify` | 51 paket, 336 test |
| Sır taraması (tüm tarihçe) | `gitleaks detect` | 0 bulgu |
| Docker sözleşme testleri | `npm run docker:config` | 13 test |
| Tekrarlanabilir imaj | 3 bağımsız temiz-önbellek build | manifest `sha256:703ee044…`, config `sha256:5dccb78a…`, 11 diffID aynı |

---

## 3. Uzak CI (L2)

PR [#1](https://github.com/cayankuzu/EtkinLink/pull/1) ile tetiklendi.
`skipped`, `cancelled`, `neutral`, `timed_out`, `action_required` **PASS
değildir.**

### Mobil kalite kapısı — `36a3e105`, run `33917231524`

| Job | main @ `638742bb` | aday @ `36a3e105` |
|---|---|---|
| `feature-freeze` | success | **success** |
| `quality` | success | **success** |
| `database-security` | success | **success** |
| `edge-functions` | success | **success** |
| `cloudflare-edge` | success | **success** |
| `secret-scan` | **failure** | **success** ← P0-1 kapandı |
| `android-debug` | **skipped** | **success** ← skipped bir kapı değildi |

7/7 success.

### Docker deterministic validation

| Job | main @ `638742bb` | aday @ `36a3e105` | `de5e97ac` |
|---|---|---|---|
| `Migration, RLS, restore and contracts` | **failure** | **success** ← P0-2 kapandı | success |
| `Toxiproxy resilience` | success | success | success |
| `Bounded synthetic load` | success | success | success |
| `Compose, deterministic build and supply chain` | **failure** | failure (farklı neden) | failure (farklı neden) |

Build job'ının üç ayrı nedeni sırayla açığa çıktı; her biri bir öncekinin
düzelmesiyle görünür oldu:

1. **Image ID uyuşmazlığı** (P0-3, main'deki neden) — `de5e97ac`'de kapandı.
   Runner çıktısı:
   `{"event":"reproducible_build_verified","archives":3,`
   `"imageManifestDigest":"sha256:ae536c2f…","configDigest":"sha256:cc32353a…"}`
   Üç bağımsız temiz-önbellek build, tek imaj; provenance arşivi aynı manifest'i
   taşıyor.
2. **`OCI exporter is not supported for the docker driver`** — runner'ın
   varsayılan buildx sürücüsü OCI arşivi yazamaz. `docker-container` sürücüsü
   kuruldu; provenance kapatılmadı.
3. **Trivy OCI tar'ı okuyamıyor + gerçek CVE'ler** — tarayıcı OCI layout
   dizinine yönlendirildi; 11 düzeltilebilir Node.js CVE'sinden 7'si npm 12.0.2
   pinlenerek kapatıldı, kalan 4'ü adlı ve tarihli istisna olarak kayıtlı.

#### Build job — kapanış, `b03afee`, run `33939826570`

Dört neden sırayla açığa çıktı ve dördü de kapandı. Runner çıktısı:

```
{"event":"compose_validated","services":["contract-tests","k6","resilience-tests","toxiproxy","upstream-mock"]}
{"event":"reproducible_build_verified","archives":3,
 "imageManifestDigest":"sha256:b765d8b1…","configDigest":"sha256:436259c4…"}
{"event":"evidence_secret_scan_passed","inputs":["artifacts/docker/build","artifacts/docker/supply-chain"]}
```

| Job | `b03afee` |
|---|---|
| `Compose, deterministic build and supply chain` | **success** |
| `Migration, RLS, restore and contracts` | success |
| `Toxiproxy resilience` | success |
| `Bounded synthetic load` | success |
| `Docker validation gate` (required aggregator) | **success** |

5/5 success.

**Not:** dördüncü neden benim eklediğim regresyondu. npm 12.0.2 pinlendiğinde
`$NPM_CONFIG_CACHE/_logs` altına duvar saatinden türeyen dosya adları yazıldı ve
katman her build'de değişti. Kapı bunu `rootfs diffIDs differ` diyerek yakaladı —
tekrarlanabilirlik kapısının varlık sebebi tam olarak budur.

---

## 4. Kanıtı olmayan — iddia edilmiyor (L3/L4)

Bunlar eksiklik olarak açıkça kayıtlıdır; "yapıldı" denmez.

| Alan | Neden yok | Kapatmak için gereken |
|---|---|---|
| İmzalı Android/iOS artifact | Production imza anahtarları CI secret store'da; yerelde yok | EAS Build ile imzalı AAB + IPA |
| TestFlight / Internal Track | Mağaza hesabı erişimi yok | Gerçek yükleme ve build işleme kaydı |
| Gerçek cihazda push | İki platformda fiziksel cihaz gerekir | foreground/background/terminated, cold/warm, izin verildi/reddedildi matrisi |
| VoiceOver / TalkBack | Gerçek cihaz gerekir | Kritik yolculukların ekran okuyucuyla geçilmesi |
| Hosted staging yük testi | Barındırılan staging ortamı yok | Gerçekçi veri hacmiyle k6 + `EXPLAIN (ANALYZE, BUFFERS)` |
| PITR / restore tatbikatı | Ayrı ortam gerekir | Ölçülmüş RPO/RTO |
| Cloudflare deploy/canary | Hesap/zone/token erişimi yok | account/zone/DNS/TLS/WAF/binding export + canary + rollback |
| OTA production promote | İmzalı binary olmadan doğrulanamaz | Store artifact içinde channel/runtime/URL denetimi |
| `main` dal koruması | **Kapalı** — `gh api …/branches/main/protection` → 404 | PR zorunluluğu, required checks, force-push yasağı |

---

## 5. Yayın kararı

Depo tarafındaki iş bitti; dış kanıt eksik.

> **IMPLEMENTATION COMPLETE — RELEASE NO-GO UNTIL SAME-SHA
> RUNTIME/PROVIDER/DEVICE/STORE EVIDENCE IS VERIFIED.**

Bu karar, uzak CI yeşile döndüğünde bile değişmez; L3 ve L4 tamamlanmadan `GO`
verilemez. Adımlar `docs/MANUAL_STEPS.md` içindedir.

---

## 6. Bakım

- Aday SHA değişirse bu dosyadaki bütün sonuçlar geçersizdir; yeniden koşulur.
- Bir iddia buradan silinmeden ilgili guard kaldırılamaz.
- "Geçti" yazan ama komutu yazılmayan satır kabul edilmez.
