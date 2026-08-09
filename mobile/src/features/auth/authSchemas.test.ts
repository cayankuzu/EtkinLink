import {
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from './authSchemas';

describe('kimlik doğrulama şemaları', () => {
  it('geçerli kayıt bilgilerini kabul eder', () => {
    const result = signUpSchema.safeParse({
      email: 'ece@example.com',
      password: 'Guvenli1234',
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['kısa şifre', 'Abc123'],
    ['büyük harfsiz', 'guvenli1234'],
    ['küçük harfsiz', 'GUVENLI1234'],
    ['rakam olmadan', 'GuvenliSifre'],
    ['72 karakterden uzun', `Aa1${'x'.repeat(70)}`],
  ])('%s kaydı reddeder', (_caseName, password) => {
    const result = signUpSchema.safeParse({
      email: 'ece@example.com',
      password,
    });
    expect(result.success).toBe(false);
  });

  it('geçersiz e-posta ile kayıt oluşturmaz', () => {
    expect(
      signUpSchema.safeParse({
        email: 'bozuk',
        password: 'Guvenli1234',
      }).success,
    ).toBe(false);
  });

  it('girişte boş şifreyi ve bozuk e-postayı reddeder', () => {
    expect(
      signInSchema.safeParse({ email: 'bozuk', password: '' }).success,
    ).toBe(false);
  });

  it('şifre yenileme e-postasını ve yeni şifreyi doğrular', () => {
    expect(
      forgotPasswordSchema.safeParse({ email: 'ece@example.com' }).success,
    ).toBe(true);
    expect(
      newPasswordSchema.safeParse({ password: 'Guvenli1234' }).success,
    ).toBe(true);
  });
});
