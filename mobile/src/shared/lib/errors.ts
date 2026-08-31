export type AppErrorCode =
  | 'configuration'
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limit'
  | 'unavailable'
  | 'unknown';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

type ErrorLike = {
  message?: string;
  name?: string;
  code?: string;
  status?: number;
  context?: unknown;
};

export function isAbortError(error: unknown): boolean {
  const value = error as ErrorLike;
  return value?.name === 'AbortError' || value?.code === 'ABORT_ERR';
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const value = error as ErrorLike;
  const message = value?.message || '';
  const status =
    value?.status ??
    (value?.context instanceof Response ? value.context.status : undefined);

  if (isAbortError(error)) {
    return new AppError('network', 'İstek iptal edildi.', error);
  }
  if (/network|fetch|timeout/i.test(message)) {
    return new AppError(
      'network',
      'İnternet bağlantını kontrol edip tekrar dene.',
      error,
    );
  }
  if (status === 401 || value?.code === 'PGRST301') {
    return new AppError(
      'unauthorized',
      'Oturumun sona erdi. Lütfen yeniden giriş yap.',
      error,
    );
  }
  if (status === 403 || value?.code === '42501') {
    return new AppError('forbidden', 'Bu işlem için yetkin bulunmuyor.', error);
  }
  if (status === 404 || value?.code === 'P0002') {
    return new AppError('not_found', 'Aradığın içerik bulunamadı.', error);
  }
  if (
    status === 400 ||
    status === 422 ||
    value?.code === '23514' ||
    value?.code === '22023'
  ) {
    return new AppError(
      'validation',
      'Gönderilen bilgileri kontrol edip tekrar dene.',
      error,
    );
  }
  if (status === 409 || value?.code === '23505' || value?.code === '40001') {
    return new AppError(
      'conflict',
      'Bilgi başka bir işlemle değişti. Yenileyip tekrar dene.',
      error,
    );
  }
  if (status === 429 || value?.code === 'P0001') {
    return new AppError(
      'rate_limit',
      'Çok sık deneme yapıldı. Kısa bir süre sonra tekrar dene.',
      error,
    );
  }
  if (status !== undefined && status >= 500) {
    return new AppError(
      'unavailable',
      'Hizmet geçici olarak kullanılamıyor. Lütfen tekrar dene.',
      error,
    );
  }
  return new AppError(
    'unknown',
    'Beklenmeyen bir sorun oluştu. Lütfen tekrar dene.',
    error,
  );
}

export function isTransientError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const code = toAppError(error).code;
  // A rate-limit response is an intentional policy boundary. Treating it as a
  // transport failure would allow callers to bypass the limited edge/origin.
  return code === 'network' || code === 'unavailable';
}
