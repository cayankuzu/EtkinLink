# Production hazırlık özeti

| Alan                    | Repo durumu                                                                 | Dış kanıt                                       | Karar    |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- | -------- |
| Push dispatcher/receipt | Batch claim, timeout/retry, receipt state machine, Vault auth ve cron hazır | Staging deploy + gerçek cihaz teslimi yok       | Bekliyor |
| Gizlilik                | Teknik envanter, iOS manifest ve Play eşlemesi hazır                        | Mağaza konsolu/hukuki metin karşılaştırması yok | Bekliyor |
| Auth enumeration        | Client precheck kaldırıldı, eski RPC yetkisi migration ile kapatıldı        | Staging saldırı testi yok                       | Bekliyor |
| Bağımlılıklar           | Expo/React Native hizalı, production audit allowlist guard'lı               | CI yeniden koşmalı                              | Koşullu  |
| RLS/IDOR/rate limit     | pgTAP ve migration sözleşmeleri hazır                                       | Staging DB testi yok; Docker kullanılmadı       | Bekliyor |
| Mobil kalite            | Typecheck/lint/test/coverage/Doctor kapıları tanımlı                        | Sonuçlar quality-gates belgesinde               | Koşullu  |
| E2E/offline             | Maestro ve gerçek staging backend senaryoları hazır                         | Workflow henüz çalışmadı                        | Bekliyor |
| Ölçek                   | 25 → 250 → hedef, en çok 10K k6 kapısı hazır                                | Staging 10K artifact'ı yok                      | Bekliyor |
| Release                 | Signed AAB/IPA, entitlement, privacy ve source map pipeline'ı hazır         | Signed artifact yok                             | NO-GO    |

Docker kullanılmadan yapılabilen yerel/statik kontroller uygulanır. Veritabanı davranışı için kaynak incelemesi veya mock sonucu, staging pgTAP/RLS kanıtı gibi sunulmaz.
