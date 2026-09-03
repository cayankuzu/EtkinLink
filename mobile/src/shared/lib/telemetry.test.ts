import { sanitizeTelemetryValue, warnRedacted } from './telemetry';

describe('telemetri PII filtresi', () => {
  it('e-posta, bearer ve JWT değerlerini temizler', () => {
    expect(
      sanitizeTelemetryValue({
        detail:
          'user@example.com Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      }),
    ).toEqual({ detail: '<email> Bearer <redacted> <token>' });
  });

  it('hassas anahtarların içeriğini tamamen siler', () => {
    expect(
      sanitizeTelemetryValue({
        operation: 'auth.sign_in',
        password: 'çok-gizli',
        nested: { refreshToken: 'gizli', count: 2 },
      }),
    ).toEqual({
      operation: 'auth.sign_in',
      password: '<redacted>',
      nested: { refreshToken: '<redacted>', count: 2 },
    });
  });
});

describe('konsol log redaksiyonu', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  afterEach(() => warn.mockClear());
  afterAll(() => warn.mockRestore());

  it('sağlayıcı hatasının içeriğini konsola taşımaz', () => {
    warnRedacted(
      'Push bildirimi kaydı tamamlanamadı.',
      new Error(
        'Expo push token ExponentPushToken[abc123] rejected for user@example.com',
      ),
    );

    expect(warn).toHaveBeenCalledWith(
      'Push bildirimi kaydı tamamlanamadı.',
      'unknown',
    );
  });

  it('imzalı depolama URLsini konsola taşımaz', () => {
    warnRedacted('Profil fotoğrafları imzalanamadı.', {
      status: 403,
      message:
        'https://project.supabase.co/storage/v1/object/sign/profile-photos/11111111-1111-1111-1111-111111111111/1.jpg?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    });

    expect(warn).toHaveBeenCalledWith(
      'Profil fotoğrafları imzalanamadı.',
      'forbidden',
    );
  });

  it('mesajın kendisindeki e-postayı da temizler', () => {
    warnRedacted('user@example.com oturumu kapatılamadı.');

    expect(warn).toHaveBeenCalledWith('<email> oturumu kapatılamadı.');
  });
});
