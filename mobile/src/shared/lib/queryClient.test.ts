import { queryRetryDelay, shouldRetryQuery } from './queryClient';

describe('query retry politikası', () => {
  it('kalıcı istemci hatalarını tekrarlamaz', () => {
    expect(shouldRetryQuery(0, { status: 400 })).toBe(false);
    expect(shouldRetryQuery(0, { status: 401 })).toBe(false);
    expect(shouldRetryQuery(0, { status: 404 })).toBe(false);
  });

  it('geçici ağ, rate-limit ve sunucu hatalarını sınırlı tekrarlar', () => {
    expect(shouldRetryQuery(0, { message: 'Network request failed' })).toBe(
      true,
    );
    expect(shouldRetryQuery(1, { status: 429 })).toBe(true);
    expect(shouldRetryQuery(2, { status: 503 })).toBe(false);
  });

  it('Retry-After değerini üst sınırla uygular', () => {
    expect(queryRetryDelay(0, { retryAfter: 2 })).toBe(2_000);
    expect(queryRetryDelay(0, { retryAfter: 120 })).toBe(30_000);
  });
});
