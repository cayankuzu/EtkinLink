# Production hazırlık özeti

> Güncel ve kanonik karar [release-readiness.md](release-readiness.md), dış sistem adımları [MANUAL_STEPS.md](MANUAL_STEPS.md), açık riskler [risk-register.md](risk-register.md) içindedir. Aşağıdaki repo durumu tek başına release kanıtı değildir. Güncel karar **NO-GO**'dur.

## 2026-08-31 güncel repo kanıtı

Repo envanteri 57 forward migration ile yedi pgTAP dosyasındaki toplam 283 planlı kontroldür. Canonical Supabase `docker:test` profili yerelde uçtan uca geçti: 57 migration temiz replay, `public` lint 0 bulgu, 7 dosya / 283 pgTAP, dump/restore ve Edge/Worker/upstream contract. Bu koşu `gitTreeClean=false` ile üretildiği için aynı-SHA release kanıtı değildir; GitHub `docker-validation.yml` sonucu henüz bu kayda bağlı değildir. Bu nedenle linked staging, gerçek cihaz/provider ve signed store artifact kapılarında PASS iddiası yoktur.

| Alan                    | Repo durumu                                                                   | Dış kanıt                                       | Karar    |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| Push dispatcher/receipt | Batch claim, timeout/retry, receipt state machine, Vault auth ve cron hazır   | Staging deploy + gerçek cihaz teslimi yok       | Bekliyor |
| Gizlilik                | Teknik envanter, iOS manifest ve Play eşlemesi hazır                          | Mağaza konsolu/hukuki metin karşılaştırması yok | Bekliyor |
| Auth enumeration        | Client precheck kaldırıldı, eski RPC yetkisi migration ile kapatıldı          | Staging saldırı testi yok                       | Bekliyor |
| Bağımlılıklar           | Expo/React Native hizalı, production audit allowlist guard'lı                 | CI yeniden koşmalı                              | Koşullu  |
| RLS/IDOR/rate limit     | 57 migration, 7 pgTAP dosyası/283 plan yerel Docker profilinde geçti; owner-scoped RPC rol ACL sözleşmesi eklendi | Linked staging DB kanıtı yok                    | Bekliyor |
| Mobil kalite            | Typecheck/lint/test/coverage/Doctor kapıları tanımlı                          | Sonuçlar quality-gates belgesinde               | Koşullu  |
| E2E/offline             | Maestro ve gerçek staging backend senaryoları hazır                           | Workflow henüz çalışmadı                        | Bekliyor |
| Ölçek                   | 25 → 250 → hedef, en çok 10K k6 kapısı hazır                                  | Staging 10K artifact'ı yok                      | Bekliyor |
| Release                 | Signed AAB/IPA, entitlement, privacy ve source map pipeline'ı hazır           | Signed artifact yok                             | NO-GO    |

Docker yalnız test/CI sınırı olarak kullanılır: canonical Supabase CLI yerel stack'i, seçici mock, fault injection, bounded sentetik yük ve supply-chain kontrolleri kapsamdadır. React Native runtime, emulator/fiziksel cihaz, EAS/signing, hosted Supabase/Cloudflare ve gerçek push provider'ları Docker kapsamına alınmaz. Yerel Docker, kaynak incelemesi veya mock sonucu staging pgTAP/RLS, gerçek cihaz ya da production kanıtı gibi sunulmaz.
