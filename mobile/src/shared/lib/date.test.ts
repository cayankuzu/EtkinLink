import { formatMessageDateTime, formatMessagePreviewDateTime } from './date';

describe('mesaj tarih ve saatleri', () => {
  const value = '2026-08-08T16:45:00.000Z';

  it('mesaj balonunda tarih, yıl ve saati birlikte gösterir', () => {
    const result = formatMessageDateTime(value);

    expect(result).toContain('2026');
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('oda kartı önizlemesinde kısa tarih ve saati birlikte gösterir', () => {
    expect(formatMessagePreviewDateTime(value)).toMatch(
      /^\d{2}\.\d{2}\.\d{2} · \d{2}:\d{2}$/,
    );
  });
});
