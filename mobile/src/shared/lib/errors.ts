export type AppErrorCode =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'rate_limit'
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

type ErrorLike = { message?: string; code?: string; status?: number };

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const value = error as ErrorLike;
  const message = value?.message || 'Beklenmeyen bir sorun oluştu.';
  if (/network|fetch|timeout/i.test(message)) {
    return new AppError(
      'network',
      'İnternet bağlantını kontrol edip tekrar dene.',
      error,
    );
  }
  if (value?.status === 401 || value?.code === 'PGRST301') {
    return new AppError(
      'unauthorized',
      'Oturumun sona erdi. Lütfen yeniden giriş yap.',
      error,
    );
  }
  if (value?.status === 403 || value?.code === '42501') {
    return new AppError('forbidden', message, error);
  }
  if (value?.status === 404 || value?.code === 'P0002') {
    return new AppError('not_found', message, error);
  }
  if (value?.code === '23514' || value?.code === '22023') {
    return new AppError('validation', message, error);
  }
  if (value?.code === 'P0001') {
    return new AppError('rate_limit', message, error);
  }
  return new AppError('unknown', message, error);
}
