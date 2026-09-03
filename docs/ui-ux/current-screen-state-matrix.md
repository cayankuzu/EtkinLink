# Mevcut ekran durum matrisi

Bu matris, dondurulmuş ürün yüzeyindeki ekranların hangi durumları gösterdiğini kaydeder. Yeni ekran veya durum eklenmemiştir; amaç, var olan her ekranın aynı durum dilini kullandığını doğrulamaktır.

Ürün yüzeyi sözleşmesi [existing-feature-contract.md](../existing-feature-contract.md) ve `quality/feature-surface.snapshot.json` dosyalarındadır: **5 tab, 43 stack route, 39 screen entrypoint, 26 public tablo**. Bu matris `mobile/src/**/​*Screen.tsx` altındaki **40 ekran dosyasını** kapsar (39 entrypoint + ortak `Screen` kabuğu).

## Ortak durum dili

Bütün ekranlar aynı paylaşılan bileşenleri kullanır; ekran başına özel durum bileşeni yazılmaz:

| Durum | Bileşen | Kaynak |
| ----- | ------- | ------ |
| İlk yükleme / iskelet | `Skeleton` | `shared/components/Skeleton.tsx` |
| Boş ve bilgilendirme | `StateView` | `shared/components/StateView.tsx` |
| Kurtarılabilir hata | `ErrorState` | `shared/components/StateView.tsx` |
| Alan içi doğrulama hatası | `InlineError` | `shared/components/StateView.tsx` |
| Pull-to-refresh | `RefreshableContent` | `shared/components/RefreshableContent.tsx` |
| Beklenmeyen render hatası | `AppErrorBoundary` | `shared/components/AppErrorBoundary.tsx` |
| Meşgul / çift gönderim koruması | `AppButton` `loading`/`disabled` | `shared/components/AppButton.tsx` |

Hata metinleri ham HTTP/Supabase mesajı değildir: `toAppError` sabit bir `AppErrorCode` ve Türkçe, eyleme geçirilebilir bir mesaj üretir (`shared/lib/errors.ts`).

## Liste ekranları

Liste ekranları `FlashList` + cursor pagination kullanır. Sayfa boyutları `shared/constants/limits.ts` içindeki `paginationLimits` sabitlerinden gelir.

| Ekran | Yükleme | Yenileme | Sayfalama | Boş/Hata | Meşgul |
| ----- | ------- | -------- | --------- | -------- | ------ |
| `DiscoverScreen` | ✔ | ✔ | ✔ | ✔ | mutasyon yok (kaydetme optimistik) |
| `EventSearchScreen` | ✔ (`isFetching` → arama durumu) | ✔ | yerel indeks üzerinde filtre | ✔ | — |
| `SavedEventsScreen` | ✔ | ✔ | ✔ | ✔ | — |
| `RoomsScreen` | ✔ | ✔ | ✔ | ✔ | — |
| `RoomDetailScreen` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `RoomParticipantsScreen` | ✔ | ✔ | tek sayfa, `paginationLimits.roomParticipants` ile sınırlı | ✔ | — |
| `MessagesScreen` | ✔ | ✔ | ✔ | ✔ (arama sonucu boşu ayrı) | — |
| `DirectChatScreen` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `MatchingLikesScreen` | ✔ | ✔ | ✔ | ✔ | ✔ |
| `BlockedUsersScreen` | ✔ | ✔ | tek sayfa (`list_blocked_users` sayfalamasız) | ✔ | ✔ |
| `CityPickerScreen` | statik şehir listesi | — | — | ✔ | — |

`RoomParticipantsScreen` ve `BlockedUsersScreen` bilinçli olarak tek sayfadır: ikisi de sınırlı boyutlu listelerdir ve sayfalama eklemek yeni bir kullanıcı davranışı gerektirirdi. Sınır `paginationLimits` içinde adlandırılmıştır; `list_blocked_users` sayfalamasızdır ve bu durum [risk-register.md](../risk-register.md) kapsamında izlenir.

## Form ve akış ekranları

| Ekran grubu | Doğrulama | Meşgul/çift gönderim | Hata | Oturum sonu |
| ----------- | --------- | -------------------- | ---- | ----------- |
| `SignInScreen`, `SignUpScreen`, `ForgotPasswordScreen`, `NewPasswordScreen` | react-hook-form + zod şemaları (`authSchemas`) | `AppButton` `loading` + `disabled` | `InlineError`; enumeration-safe sunucu cevabı | `sessionStore` recovery fazı |
| `SignUpProfileScreen`, `SignUpInterestsScreen`, `SignUpPhotosScreen`, `SignUpReviewScreen` | `onboardingSchemas` | ✔ | `InlineError` | taslak `registrationDraftStore` içinde kalır |
| `EditProfileScreen`, `EditPhotosScreen`, `EditInterestsScreen`, `MatchProfileEditScreen` | zod | ✔ | `InlineError` + `ErrorState` | ✔ |
| `ChangePasswordScreen`, `ProfileVisibilityScreen`, `ProfileMatchFiltersScreen`, `MatchFiltersScreen`, `EventFiltersScreen`, `ChatSettingsScreen`, `SettingsScreen` | zod / kontrollü giriş | ✔ | `InlineError` | ✔ |
| `AboutLegalScreen`, `WelcomeScreen`, `EmailSentScreen`, `ResetEmailSentScreen` | statik içerik | ilgili değil | ilgili değil | ilgili değil |

Statik içerik ekranlarında yükleme/boş/hata durumu **bilinçli olarak yoktur**: ağ çağrısı yapmazlar. Bunu eksik olarak işaretlemek yanlış pozitif olurdu.

## Çevrimdışı ve süreç sonlandırma

Çevrimdışı davranış ekran başına değil, ortak katmanda tanımlıdır ve [offline-and-concurrency.md](../offline-and-concurrency.md) belgesinde sözleşmelenmiştir:

- TanStack Query kalıcılığı kullanıcı-kapsamlıdır ve oturum değişiminde purge edilir (`shared/lib/queryPersistence.ts`);
- mesaj gönderimi kalıcı outbox üzerinden yürür; süreç öldürme sonrası replay edilir (`shared/lib/chatOutbox.ts`, `app/startup/OutboxSyncController.tsx`);
- etkinlik akışı için anlık görüntü önbelleği vardır (`features/events/eventFeedSnapshot.ts`);
- Realtime yeniden bağlanma ve boşluk yakalama oda/sohbet hook'larındadır.

## Doğrulama

| Kontrol | Sonuç |
| ------- | ----- |
| `npm --prefix mobile run test` | 49 suite / 320 test |
| `npm --prefix mobile run accessibility:guards` | 74 dosya temiz |
| `npm --prefix mobile run hardcode:guards` | 143 dosya ham renk/sayfa boyutu içermiyor |
| `npm run feature-freeze` | 5 tab, 43 route, 39 ekran, 26 tablo — değişmedi |

Bu matris statik ve test düzeyinde kanıttır. Gerçek cihazda durum geçişlerinin görsel doğrulaması [device-matrix.md](../device-matrix.md) matrisinde `Bekliyor` durumundadır.
