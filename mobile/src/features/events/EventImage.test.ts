import { compatibleEventImageUrl } from './EventImage';

describe('etkinlik görsel uyumluluğu', () => {
  it('AVIF afişleri Android uyumlu WebP kaynağına dönüştürür', () => {
    const source = 'https://cdn.example.com/poster.avif';
    const result = compatibleEventImageUrl(source);
    expect(result).toContain('https://wsrv.nl/');
    expect(result).toContain('output=webp');
    expect(decodeURIComponent(result)).toContain(source);
  });

  it('desteklenen görsel adresini değiştirmez', () => {
    const source = 'https://cdn.example.com/poster.jpg';
    expect(compatibleEventImageUrl(source)).toBe(source);
  });
});
