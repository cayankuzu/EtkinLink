# EtkinLink — Ekran Durum Matrisi

> Bu dosya `npm run screen-state:matrix` ile üretilir; elle düzenlenmez.
> Kaynak: 39 ekran girişi, `mobile/src/features/**/*Screen.tsx`.

Ürün dondurması gereği yeni durum ekranı eklenmez. Buradaki soru "boş durum
yapalım mı" değil, "veri çeken her ekran ne olduğunu söylüyor mu" sorusudur.
Yükleniyor, hata ve boş durumu birbirinden ayırt edilemeyen bir ekran
kullanıcıyı "oldu mu?" sorusuyla bırakır.

`·` işareti eksiklik değil, **o ekranda o durumun ifade edilmediği** anlamına
gelir. Veri çekmeyen bir ekranın yükleme durumu olmaması doğrudur.

| Ekran | Alan | Veri çeker | Liste | loading | error | empty | refresh | offline | keyboard | safeArea | busy |
|---|---|---|---|---|---|---|---|---|---|---|---|
| EmailSentScreen | auth | hayır | hayır | · | · | · | · | ✓ | · | ✓ | ✓ |
| ForgotPasswordScreen | auth | hayır | hayır | · | · | · | · | ✓ | · | · | ✓ |
| NewPasswordScreen | auth | hayır | hayır | · | · | · | · | · | · | · | ✓ |
| ResetEmailSentScreen | auth | hayır | hayır | · | · | · | · | ✓ | · | · | · |
| SignInScreen | auth | hayır | hayır | · | · | · | · | ✓ | · | · | ✓ |
| SignUpInterestsScreen | auth | evet | hayır | ✓ | ✓ | · | ✓ | · | · | · | ✓ |
| SignUpPhotosScreen | auth | hayır | hayır | · | ✓ | · | · | · | · | · | ✓ |
| SignUpProfileScreen | auth | hayır | hayır | · | · | · | · | · | · | · | ✓ |
| SignUpReviewScreen | auth | hayır | hayır | · | ✓ | · | · | ✓ | · | · | ✓ |
| SignUpScreen | auth | hayır | hayır | · | · | · | · | ✓ | · | · | ✓ |
| WelcomeScreen | auth | hayır | hayır | · | · | · | · | · | · | ✓ | · |
| CityPickerScreen | events | hayır | evet | · | · | ✓ | · | · | ✓ | ✓ | · |
| DiscoverScreen | events | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · |
| EventDetailScreen | events | hayır | hayır | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| EventFiltersScreen | events | evet | hayır | · | · | ✓ | · | · | ✓ | ✓ | · |
| EventSearchScreen | events | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · |
| SavedEventsScreen | events | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · |
| MatchCardsScreen | matching | evet | hayır | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| MatchFiltersScreen | matching | evet | hayır | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ |
| MatchHubScreen | matching | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| MatchingLikesScreen | matching | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| MatchProfileEditScreen | matching | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| ChatSettingsScreen | messages | hayır | hayır | · | · | · | · | · | · | ✓ | · |
| DirectChatScreen | messages | evet | evet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| MessagesScreen | messages | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · |
| AboutLegalScreen | profile | hayır | hayır | · | · | · | · | ✓ | · | ✓ | · |
| BlockedUsersScreen | profile | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| ChangePasswordScreen | profile | evet | hayır | · | ✓ | · | · | ✓ | · | ✓ | ✓ |
| EditInterestsScreen | profile | evet | hayır | ✓ | ✓ | · | ✓ | · | · | ✓ | ✓ |
| EditPhotosScreen | profile | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| EditProfileScreen | profile | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| ProfileMatchFiltersScreen | profile | evet | hayır | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ |
| ProfileScreen | profile | evet | hayır | ✓ | ✓ | · | ✓ | · | · | ✓ | · |
| ProfileVisibilityScreen | profile | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| PublicProfileScreen | profile | evet | hayır | ✓ | ✓ | · | ✓ | · | · | ✓ | · |
| SettingsScreen | profile | evet | hayır | ✓ | ✓ | · | · | · | · | ✓ | ✓ |
| RoomDetailScreen | rooms | evet | evet | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| RoomParticipantsScreen | rooms | evet | evet | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · |
| RoomsScreen | rooms | evet | evet | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · |

## Özet

- Ekran girişi: **39**
- Veri çeken ekran: **25**
- Veri çeken ekranlarda `loading`: **23/25**
- Veri çeken ekranlarda `error`: **24/25**
- Veri çeken ekranlarda `empty`: **14/25**
- Veri çeken ekranlarda `refresh`: **16/25**
- Veri çeken ekranlarda `offline`: **3/25**
- Veri çeken ekranlarda `keyboard`: **4/25**
- Veri çeken ekranlarda `safeArea`: **24/25**
- Veri çeken ekranlarda `busy`: **16/25**

## Zorunlu sözleşme boşlukları

Sorgu çalıştıran ekran `loading` ve `error` durumlarını ayırt edilebilir
biçimde ifade etmelidir. Yalnız mutation çalıştıran ekran bunun yerine
`busy` borçludur. `empty` yalnız koleksiyon çizen ekranlar için zorunludur;
kullanıcının kendi kaydı üzerindeki form her zaman doludur. Tam yerel
yedeği olan sorgu kullanıcıyı hiç bekletmediği için yükleme/hata yüzeyi
borçlu değildir.

Boşluk yok.
