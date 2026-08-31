import { AppError, isAbortError, isTransientError, toAppError } from './errors';

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
    [{ status: 409, message: 'duplicate internals' }, 'conflict'],
    [{ code: '23505', message: 'unique constraint name' }, 'conflict'],
    [{ code: 'P0001', message: 'çok hızlı' }, 'rate_limit'],
    [{ status: 429, message: 'quota internals' }, 'rate_limit'],
    [{ status: 503, message: 'origin hostname' }, 'unavailable'],
    [{ message: 'başka hata' }, 'unknown'],
    [null, 'unknown'],
  ] as const)('%o girdisini %s olarak sınıflandırır', (input, code) => {
    const result = toAppError(input);

    expect(result).toBeInstanceOf(AppError);
    expect(result.code).toBe(code);
    expect(result.cause).toBe(input);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('backend ayrıntılarını kullanıcı mesajına sızdırmaz', () => {
    for (const input of [
      { status: 403, message: 'policy room_messages_select failed' },
      { status: 404, message: 'row id 2bc6 was missing' },
      { code: '23514', message: 'events_external_id_check' },
      { message: 'postgres host internal-db.local' },
    ]) {
      expect(toAppError(input).message).not.toContain(input.message);
    }
  });

  it('iptali retry/fallback için transient saymaz', () => {
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(isAbortError(aborted)).toBe(true);
    expect(isTransientError(aborted)).toBe(false);
    expect(isTransientError({ status: 503 })).toBe(true);
    expect(isTransientError({ status: 429 })).toBe(false);
  });
});
