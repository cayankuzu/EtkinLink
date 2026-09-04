# EtkinLink — Depo Gerçeği

Bu dosya, aday SHA'da **ölçülmüş** depo durumudur. Sayılar komuttan gelir;
elle yazılmaz.

**Aday SHA:** `36a3e105` · **Dal:** `chore/final-release-candidate-aaa`
**Baz main SHA:** `638742bb` · **Tarih:** 2026-09-04

---

## 1. Dal ve sürüm ayrışması

| | Değer |
|---|---|
| Varsayılan dal | `main` @ `638742bb` |
| Hedef dal | `chore/final-release-candidate-aaa` @ `36a3e105` |
| main'in ulaşamadığı commit | 5 |
| Açık PR | [#1](https://github.com/cayankuzu/EtkinLink/pull/1) (draft) |
| Release tag | Yok |
| **main dal koruması** | **Yok** — `gh api repos/cayankuzu/EtkinLink/branches/main/protection` → `404 Branch not protected` |

Aday dalındaki commitler:

| SHA | Konu |
|---|---|
| `761d4a4` | Kimlik bilgilerini kanıttan çıkar, kapıları ortamdan bağımsız yap |
| `230b71d` | Tipografi ölçeğine dürüst adlar, 10px kademesini tabana çek |
| `33f4979` | Araç imajını gerçekten tekrarlanabilir yap, doğru şeyi karşılaştır |
| `764e3df` | Token paletini ölçülmüş kontrast tabanında tut |
| `fb1cda0` | Her kontrolü 48dp etkin hedefe çek, pazarlama paketini yüzeye bağla |
| `36a3e105` | Kod ve ekran-durum denetimini ağaçtan türet |

> `230b71d` ve `764e3df` bu dalda paralel bir oturum tarafından üretildi;
> tipografi ve kontrast çalışması onlara aittir. Aynı dala eşzamanlı yazıldığı
> için birkaç dosya beklenenden farklı commit'e düşmüştür; ağaç doğrudur,
> atıf dağınıktır.

## 2. Çalışma ağacı

`git status --porcelain=v1 --untracked-files=all` → temiz.

## 3. İzlenen dosya envanteri

`npm run audit:manifest` çıktısından (`quality/full-code-audit-manifest.json`):

| Sınıf | Adet |
|---|---|
| OWNED_SOURCE | 225 |
| OWNED_TEST | 81 |
| OWNED_CONFIG | 76 |
| OWNED_MIGRATION | 57 |
| OWNED_DOC | 51 |
| OWNED_CI | 11 |
| BINARY_ASSET | 46 |
| LOCKFILE | 4 |
| EVIDENCE | 2 |
| GENERATED | 1 |
| **Toplam** | **554** |

- İncelenen dosya: **501**
- İncelenen satır: **81.025**
- Okunamayan: **0**
- Risk sinyali taşıyan dosya: **0**
- Beyan: `FULL_CODE_AUDIT_COMPLETE`

Binary varlıklar satır denetimine girmez; hash ve boyutla izlenir.

## 4. Ürün yüzeyi

`npm run feature-freeze` → **5 sekme, 43 stack route, 39 ekran, 26 public
tablo.** Başlangıç ve final sayıları aynıdır; bu dalda ürün yüzeyi
değişmemiştir.

| Yüzey | Değer |
|---|---|
| Sekmeler | Discover, Matches, Messages, Profile, Rooms |
| Bildirim türleri | 9 (yeni tür eklenmedi) |
| Storage bucket | `profile-photos` (özel) |
| Edge Functions | 6 |

## 5. Yerel kapı sonuçları

| Kapı | Komut | Sonuç |
|---|---|---|
| Ürün dondurma | `npm run feature-freeze` | PASS |
| Kod denetim manifesti | `npm run audit:manifest:check` | PASS |
| Release evidence testleri | `npm run release:evidence:test` | PASS |
| Tip denetimi | `npm run typecheck` | PASS |
| Lint | `npm run lint` | PASS (0 uyarı) |
| Biçim | `npm run format:check` | PASS |
| Mimari sınırları | `npm run architecture` | PASS |
| Ölü kod | `npm run deadcode` | PASS |
| Güvenlik guard'ları | `npm run security:guards` | PASS |
| Cihaz uyumluluğu | `npm run compatibility:guards` | PASS |
| Performans bütçeleri | `npm run performance:guards` | PASS |
| Erişilebilirlik | `npm run accessibility:guards` | PASS |
| Kontrast | `npm run contrast:guards` | PASS |
| **Dokunma hedefi** | `npm run touch-target:guards` | **PASS** (yeni) |
| **Ekran durumu** | `npm run screen-state:guards` | **PASS** (yeni) |
| Hardcode | `npm run hardcode:guards` | PASS |
| Kritik akış kanıtı | `npm run critical-flows` | PASS |
| OTA sınıflandırıcı | `npm run ota:classifier:test` | PASS |
| Testler | `npm run test` | PASS — 51 paket, 336 test |
| Docker sözleşmesi | `npm run docker:config` | PASS — 13 test |
| Sır taraması | `gitleaks detect` | PASS — 0 bulgu |

Yerel sonuç uzak CI sonucu yerine geçmez.
`docs/audit/claims-and-evidence-register.md` bölüm 3'e bakınız.

## 6. Uzak CI durumu

main @ `638742bb` üzerinde 4 job kırmızıydı:
`secret-scan`, `Migration, RLS, restore and contracts`,
`Compose, deterministic build and supply chain` ve bunlara bağlı
`Docker validation gate`. Üçünün de kök nedeni yerelde yeniden üretildi ve
düzeltildi; ayrıntı kanıt kütüğünde.

Aday SHA'da aynı iş akışları PR #1 ile tetiklendi. Sonuç kaydedilene kadar
"düzeldi" denmez.

## 7. Bilinen açıklar

1. `main` dal koruması kapalı.
2. İmzalı artifact, mağaza, gerçek cihaz ve sağlayıcı kanıtı yok
   (kanıt kütüğü bölüm 4).
3. `android-debug` job'ı main koşusunda `skipped` idi; skipped bir kapı yeşil
   sayılamaz.

## 8. Yeniden üretim

```bash
npm run verify            # ürün dondurma + denetim manifesti + mobil kapılar
npm run docker:config     # Compose ve sözleşme testleri
gitleaks detect           # tüm tarihçe sır taraması
node scripts/audit/build-code-audit-manifest.mjs
npm --prefix mobile run screen-state:matrix
```
