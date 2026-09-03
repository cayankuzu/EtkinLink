# Production hazırlık özeti

> Güncel ve kanonik karar [release-readiness.md](release-readiness.md), dış sistem adımları [MANUAL_STEPS.md](MANUAL_STEPS.md), açık riskler [risk-register.md](risk-register.md) içindedir. Aşağıdaki repo durumu tek başına release kanıtı değildir. Güncel karar **NO-GO**'dur.

## 2026-08-31 güncel repo kanıtı

Repo envanteri 55 forward migration ile beş pgTAP dosyasındaki toplam 251 planlı kontroldür. Docker test/CI sınırında Compose config, container contract, Toxiproxy resilience ve bounded sentetik load yerelde geçti; canonical Supabase `docker:test` profilinin tamamlanmış aynı-SHA artifact'ı ile GitHub Docker gate sonucu henüz bu kayda bağlı değildir. Bu nedenle linked staging, gerçek cihaz/provider ve signed store artifact kapılarında PASS iddiası yoktur.

| Alan                    | Repo durumu                                                                   | Dış kanıt                                       | Karar    |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| Push dispatcher/receipt | Batch claim, timeout/retry, receipt state machine, Vault auth ve cron hazır   | Staging deploy + gerçek cihaz teslimi yok       | Bekliyor |
| Gizlilik                | Teknik envanter, iOS manifest ve Play eşlemesi hazır                          | Mağaza konsolu/hukuki metin karşılaştırması yok | Bekliyor |
| Auth enumeration        | Client precheck kaldırıldı, eski RPC yetkisi migration ile kapatıldı          | Staging saldırı testi yok                       | Bekliyor |
| Bağımlılıklar           | Expo/React Native hizalı, production audit allowlist guard'lı                 | CI yeniden koşmalı                              | Koşullu  |
| RLS/IDOR/rate limit     | 55 migration, 5 pgTAP dosyası/251 plan ve canonical Docker test profili hazır | Linked staging DB kanıtı yok                    | Bekliyor |
| Mobil kalite            | Typecheck/lint/test/coverage/Doctor kapıları tanımlı                          | Sonuçlar quality-gates belgesinde               | Koşullu  |
| E2E/offline             | Maestro ve gerçek staging backend senaryoları hazır                           | Workflow henüz çalışmadı                        | Bekliyor |
| Ölçek                   | 25 → 250 → hedef, en çok 10K k6 kapısı hazır                                  | Staging 10K artifact'ı yok                      | Bekliyor |
| Release                 | Signed AAB/IPA, entitlement, privacy ve source map pipeline'ı hazır           | Signed artifact yok                             | NO-GO    |

Docker yalnız test/CI sınırı olarak kullanılır: canonical Supabase CLI yerel stack'i, seçici mock, fault injection, bounded sentetik yük ve supply-chain kontrolleri kapsamdadır. React Native runtime, emulator/fiziksel cihaz, EAS/signing, hosted Supabase/Cloudflare ve gerçek push provider'ları Docker kapsamına alınmaz. Yerel Docker, kaynak incelemesi veya mock sonucu staging pgTAP/RLS, gerçek cihaz ya da production kanıtı gibi sunulmaz.
