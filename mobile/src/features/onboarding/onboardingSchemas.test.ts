import fc from 'fast-check';

import { profileBasicsSchema } from './onboardingSchemas';

function yearsAgo(years: number): Date {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date;
}

describe('profil başlangıç şeması', () => {
  const validProfile = {
    fullName: 'Ece Yılmaz',
    username: 'ece_yilmaz',
    birthDate: yearsAgo(24),
    gender: 'woman' as const,
  };

  it('18 yaş ve üzeri geçerli profili kabul eder', () => {
    expect(profileBasicsSchema.safeParse(validProfile).success).toBe(true);
  });

  it('18 yaş altı profili reddeder', () => {
    expect(
      profileBasicsSchema.safeParse({
        ...validProfile,
        birthDate: yearsAgo(17),
      }).success,
    ).toBe(false);
  });

  it('kullanıcı adında büyük harf, boşluk ve özel karakteri reddeder', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('Ece', 'ece yilmaz', 'ece-yilmaz', 'e!ce'),
        username => {
          expect(
            profileBasicsSchema.safeParse({ ...validProfile, username })
              .success,
          ).toBe(false);
        },
      ),
    );
  });

  it.each([
    ['iki karakter', 'ab'],
    ['başta alt çizgi', '_ece'],
    ['sonda alt çizgi', 'ece_'],
    ['çift alt çizgi', 'ece__yilmaz'],
    ['ayrılmış sistem adı', 'admin'],
  ])('%s kullanıcı adını reddeder', (_caseName, username) => {
    expect(
      profileBasicsSchema.safeParse({ ...validProfile, username }).success,
    ).toBe(false);
  });

  it('ad soyadda karakter sınırını uygular', () => {
    expect(
      profileBasicsSchema.safeParse({ ...validProfile, fullName: 'E' }).success,
    ).toBe(false);
    expect(
      profileBasicsSchema.safeParse({
        ...validProfile,
        fullName: 'x'.repeat(71),
      }).success,
    ).toBe(false);
  });

  it('tanımsız cinsiyet değerini açıklayıcı hata ile reddeder', () => {
    const result = profileBasicsSchema.safeParse({
      ...validProfile,
      gender: 'unknown',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Bir seçenek belirlemelisin.',
      );
    }
  });
});
