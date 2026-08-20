import { compatibleEventImageUrl } from './EventImage';

describe('etkinlik görsel uyumluluğu', () => {
  it('HTTPS AVIF afişini üçüncü tarafa göndermeden kullanır', () => {
    const source = 'https://cdn.example.com/poster.avif';
    const result = compatibleEventImageUrl(source);
    expect(result).toBe(source);
    expect(result).not.toContain('wsrv.nl');
  });

  it('güvensiz HTTP görselini reddeder', () => {
    expect(compatibleEventImageUrl('http://cdn.example.com/poster.jpg')).toBe(
      '',
    );
  });

  it('desteklenen görsel adresini değiştirmez', () => {
    const source = 'https://cdn.example.com/poster.jpg';
    expect(compatibleEventImageUrl(source)).toBe(source);
  });
});
