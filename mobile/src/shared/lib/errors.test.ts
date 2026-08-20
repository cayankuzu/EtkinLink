import { AppError, toAppError } from './errors';

describe('uygulama hata sınıflandırması', () => {
  it('önceden sınıflandırılmış hatayı değiştirmeden döndürür', () => {
    const error = new AppError('configuration', 'Eksik yapılandırma');

    expect(toAppError(error)).toBe(error);
    expect(error.name).toBe('AppError');
  });

  it.each([
    [{ message: 'Network request failed' }, 'network'],
    [{ message: 'İstek timeout oldu' }, 'network'],
    [{ status: 401, message: 'özel ayrıntı' }, 'unauthorized'],
    [{ code: 'PGRST301' }, 'unauthorized'],
    [{ status: 403, message: 'yasak' }, 'forbidden'],
    [{ code: '42501', message: 'yetki yok' }, 'forbidden'],
    [{ status: 404, message: 'yok' }, 'not_found'],
    [{ code: 'P0002', message: 'yok' }, 'not_found'],
    [{ code: '23514', message: 'geçersiz' }, 'validation'],
    [{ code: '22023', message: 'geçersiz' }, 'validation'],
    [{ code: 'P0001', message: 'çok hızlı' }, 'rate_limit'],
    [{ message: 'başka hata' }, 'unknown'],
    [null, 'unknown'],
  ] as const)('%o girdisini %s olarak sınıflandırır', (input, code) => {
    const result = toAppError(input);

    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(code);
    expect(result.cause).toBe(input);
    expect(result.message.length).toBeGreaterThan(0);
  });
});
