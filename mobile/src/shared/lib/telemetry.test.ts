import { sanitizeTelemetryValue } from './telemetry';

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
