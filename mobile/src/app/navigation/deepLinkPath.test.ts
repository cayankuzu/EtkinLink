import { maxDeepLinkPathLength, sanitizeDeepLinkPath } from './deepLinkPath';

describe('deep link yolu sınırlama', () => {
  it('desteklenen rotayı olduğu gibi geçirir', () => {
    expect(sanitizeDeepLinkPath('auth/reset-password')).toBe(
      'auth/reset-password',
    );
  });

  it('baştaki eğik çizgiyi korur', () => {
    expect(sanitizeDeepLinkPath('/auth/reset-password')).toBe(
      '/auth/reset-password',
    );
  });

  it('query string React Navigation ayrıştırıcısına ulaşmaz', () => {
    expect(sanitizeDeepLinkPath('auth/reset-password?code=abc&next=%2F')).toBe(
      'auth/reset-password',
    );
  });

  it('fragment de düşürülür', () => {
    expect(sanitizeDeepLinkPath('auth/reset-password#access_token=abc')).toBe(
      'auth/reset-password',
    );
  });

  it('GHSA-vcc3-ghjq-m6fr girdisi çözücüye ulaşmadan reddedilir', () => {
    // Malformed percent sequences are the input the advisory is about.
    expect(sanitizeDeepLinkPath('auth/%%%%%%%%%%%%%%%%%%%%')).toBeUndefined();
    expect(sanitizeDeepLinkPath('auth/%E0%A4%A')).toBeUndefined();
    expect(sanitizeDeepLinkPath('auth/%zz')).toBeUndefined();
  });

  it('geçerli yüzde kodlaması korunur', () => {
    expect(sanitizeDeepLinkPath('auth/reset%2Dpassword')).toBe(
      'auth/reset%2Dpassword',
    );
  });

  it('aşırı uzun yol reddedilir', () => {
    const long = `auth/${'a'.repeat(maxDeepLinkPathLength)}`;
    expect(sanitizeDeepLinkPath(long)).toBeUndefined();
  });

  it('sınırdaki uzunluk kabul edilir', () => {
    const exact = 'a'.repeat(maxDeepLinkPathLength);
    expect(sanitizeDeepLinkPath(exact)).toBe(exact);
  });

  it('boş ve yalnız query olan yol reddedilir', () => {
    expect(sanitizeDeepLinkPath('')).toBeUndefined();
    expect(sanitizeDeepLinkPath('?code=abc')).toBeUndefined();
    expect(sanitizeDeepLinkPath('#fragment')).toBeUndefined();
  });

  it('string olmayan girdi reddedilir', () => {
    expect(
      sanitizeDeepLinkPath(undefined as unknown as string),
    ).toBeUndefined();
    expect(sanitizeDeepLinkPath(null as unknown as string)).toBeUndefined();
  });
});
