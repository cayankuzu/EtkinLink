import type { Event } from '@shared/types/domain';

import {
  applyRssFilters,
  buildEtkinlikIoRssPartitionUrls,
  buildEtkinlikIoRssUrls,
  cacheRssEvents,
  clearRssFeedCache,
  createRssEventPage,
  getCachedRssEvent,
  parseEtkinlikIoDetailHtml,
  parseEtkinlikIoRss,
} from './rssEventService';

const catalogHtml = `
  <input name="sehir[0]" value="40"><label><span>İstanbul</span></label>
  <input name="sehir[1]" value="6"><label><span>Ankara</span></label>
  <input name="tur[0]" value="19"><label><span>Konser</span></label>
  <input name="kategori[0]" value="1600"><label><span>Spor</span></label>
`;

const sample = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <item>
      <title>İstanbul Caz Konseri</title>
      <description><![CDATA[İstanbul'da canlı müzik gecesi.]]></description>
      <pubDate>Fri, 07 Aug 2026 21:00:00 +0300</pubDate>
      <link>https://etkinlik.io/etkinlik/12345/istanbul-caz-konseri</link>
      <guid>https://etkinlik.io/etkinlik/12345/istanbul-caz-konseri</guid>
      <enclosure type="image/png" url="https://cdn.example.com/event.png" />
      <category><![CDATA[Konser]]></category>
      <category><![CDATA[Caz Müzik]]></category>
      <content:encoded><![CDATA[<p>Etkinliğin uzun açıklaması.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe('Etkinlik.io RSS adaptörü', () => {
  it('şehir ve kategori seçimlerini doğrudan RSS sorgu parametrelerine yazar', () => {
    const urls = buildEtkinlikIoRssUrls(
      {
        query: '',
        city: 'İstanbul',
        categories: ['Konser', 'Spor'],
        date: 'all',
        sort: 'upcoming',
      },
      catalogHtml,
    );
    expect(urls).toEqual([
      'https://etkinlik.io/rss/sorgu?turIds=19&sehirIds=40',
      'https://etkinlik.io/rss/sorgu?kategoriIds=1600&sehirIds=40',
    ]);
    expect(urls.every(url => url.includes('sehirIds=40'))).toBe(true);
  });

  it('50 kayda ulaşan akışı diğer resmi filtre boyutuyla parçalara ayırır', () => {
    expect(
      buildEtkinlikIoRssPartitionUrls(
        'https://etkinlik.io/rss/sorgu?turIds=19&sehirIds=40',
        catalogHtml,
      ),
    ).toEqual([
      'https://etkinlik.io/rss/sorgu?turIds=19&kategoriIds=1600&sehirIds=40',
    ]);
  });

  it('seçilen şehir çözülemezse tüm şehirleri çeken sorguya düşmez', () => {
    expect(() =>
      buildEtkinlikIoRssUrls(
        {
          query: '',
          city: 'Bilinmeyen şehir',
          categories: [],
          date: 'all',
          sort: 'upcoming',
        },
        catalogHtml,
      ),
    ).toThrow('Tüm şehirlerden veri çekilmedi');
  });

  it('RSS kaydını uygulamanın etkinlik modeline dönüştürür', () => {
    expect(parseEtkinlikIoRss(sample)).toEqual([
      expect.objectContaining({
        id: 'etkinlik-io-12345',
        externalId: 12345,
        title: 'İstanbul Caz Konseri',
        city: 'İstanbul',
        imageUrl: 'https://cdn.example.com/event.png',
        categories: ['Konser', 'Caz Müzik'],
        sourceUrl: 'https://etkinlik.io/etkinlik/12345/istanbul-caz-konseri',
      }),
    ]);
  });

  it('aynı kategoriyi farklı yazımlarla yalnızca bir kez döndürür', () => {
    const duplicateCategorySample = sample.replace(
      '<category><![CDATA[Caz Müzik]]></category>',
      '<category><![CDATA[konser]]></category><category><![CDATA[Caz Müzik]]></category>',
    );

    expect(parseEtkinlikIoRss(duplicateCategorySample)[0]?.categories).toEqual([
      'Konser',
      'Caz Müzik',
    ]);
  });

  it('RSS yenilenirken doğrulanmış katılımcı durumunu sıfırlamaz', () => {
    const event = parseEtkinlikIoRss(sample)[0];
    if (!event) throw new Error('Test RSS kaydı oluşturulamadı.');
    cacheRssEvents([
      {
        ...event,
        databaseId: '00000000-0000-4000-8000-000000000001',
        attendeeCount: 1,
        joined: true,
      },
    ]);

    cacheRssEvents([event]);

    expect(getCachedRssEvent(event.id)).toEqual(
      expect.objectContaining({ attendeeCount: 1, joined: true }),
    );
  });

  it('bozuk veya eksik RSS kayıtlarını atlar', () => {
    expect(
      parseEtkinlikIoRss(
        '<rss><channel><item><title>Eksik</title></item></channel></rss>',
      ),
    ).toEqual([]);
  });

  it('kaynak sayfadaki tüm desteklenen JSON-LD ayrıntılarını birleştirir', () => {
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'İstanbul Caz Gecesi',
      description: '<p>Detaylı etkinlik açıklaması</p>',
      startDate: '2026-08-07T21:00:00+03:00',
      endDate: '2026-08-07T23:30:00+03:00',
      dateModified: '2026-08-01T10:00:00+03:00',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      duration: 'PT2H30M',
      typicalAgeRange: '18+',
      isAccessibleForFree: false,
      organizer: { '@type': 'Organization', name: 'Caz Derneği' },
      performer: [{ '@type': 'Person', name: 'Deniz Müzik' }],
      image: ['https://cdn.example.com/detail.png'],
      location: {
        '@type': 'Place',
        name: 'Açık Hava Sahnesi',
        address: {
          streetAddress: 'Örnek Caddesi 10',
          addressLocality: 'Kadıköy',
          addressRegion: 'İstanbul',
        },
      },
      offers: {
        price: 250,
        priceCurrency: 'TRY',
        availability: 'https://schema.org/InStock',
        url: 'https://etkinlik.io/bilet/12345',
      },
    })}</script>`;

    expect(parseEtkinlikIoDetailHtml(html, base)).toEqual(
      expect.objectContaining({
        title: 'İstanbul Caz Gecesi',
        endAt: '2026-08-07T20:30:00.000Z',
        venue: 'Açık Hava Sahnesi',
        district: 'Kadıköy',
        address: 'Örnek Caddesi 10',
        imageUrl: 'https://cdn.example.com/detail.png',
        sourceDetails: expect.objectContaining({
          organizer: 'Caz Derneği',
          performers: ['Deniz Müzik'],
          price: '250',
          currency: 'TRY',
          duration: 'PT2H30M',
          ageRange: '18+',
        }),
      }),
    );
  });

  it('şehir alanını tam eşleştirir ve kategorilerden herhangi birini kabul eder', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-07T08:00:00+03:00'));
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    const ankaraEvent: Event = {
      ...base,
      id: 'etkinlik-io-54321',
      city: 'Ankara',
      title: 'İstanbul Sanatı Ankara’da',
      description: 'İstanbul temalı özel sergi',
      categories: ['Sergi', 'Sanat'],
    };

    expect(
      applyRssFilters([base, ankaraEvent], {
        query: '',
        city: 'Ankara',
        categories: ['Konser', 'Sergi'],
        date: 'all',
        sort: 'upcoming',
      }).map(event => event.id),
    ).toEqual(['etkinlik-io-54321']);
    jest.useRealTimers();
  });

  it('Tüm tarihler seçiliyken geçmiş kayıtları da filtrelemez', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-08T08:00:00+03:00'));
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    expect(
      applyRssFilters([base], {
        query: '',
        city: null,
        categories: [],
        date: 'all',
        sort: 'upcoming',
      }),
    ).toHaveLength(1);
    jest.useRealTimers();
  });

  it('evrensel aramada mekân, ilçe ve adres alanlarını da tarar', () => {
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    const detailed: Event = {
      ...base,
      venue: 'Atatürk Kültür Merkezi',
      district: 'Beyoğlu',
      address: 'Taksim Meydanı',
    };

    for (const query of ['kültür merkezi', 'beyoğlu', 'taksim meydanı']) {
      expect(
        applyRssFilters([detailed], {
          query,
          city: null,
          categories: [],
          date: 'all',
          sort: 'upcoming',
        }),
      ).toHaveLength(1);
    }
  });

  it('başlangıç ve bitiş günleri dahil tarih aralığını filtreler', () => {
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    const nextDay: Event = {
      ...base,
      id: 'etkinlik-io-54322',
      externalId: 54322,
      startAt: '2026-08-08T21:00:00+03:00',
    };

    expect(
      applyRssFilters([base, nextDay], {
        query: '',
        city: null,
        categories: [],
        date: 'range:2026-08-07:2026-08-08',
        sort: 'upcoming',
      }).map(event => event.id),
    ).toEqual(['etkinlik-io-12345', 'etkinlik-io-54322']);
  });

  it('RSS sonucunun tamamını sanal listeye tek sayfada verir', () => {
    const base = parseEtkinlikIoRss(sample)[0];
    if (!base) throw new Error('Test RSS kaydı oluşturulamadı.');
    const events = Array.from({ length: 75 }, (_, index) => ({
      ...base,
      id: `etkinlik-io-${index + 1}`,
      externalId: index + 1,
      startAt: new Date(2026, 7, 7 + index).toISOString(),
    }));
    const page = createRssEventPage(events, {
      query: '',
      city: null,
      categories: [],
      date: 'all',
      sort: 'upcoming',
    });

    expect(page.items).toHaveLength(75);
    expect(page.nextCursor).toBeNull();
  });
});

describe('RSS personalized memory cleanup', () => {
  afterEach(clearRssFeedCache);

  it('removes cached personalized event state', () => {
    const event = parseEtkinlikIoRss(sample)[0];
    if (!event) throw new Error('The test RSS event was not created.');
    cacheRssEvents([{ ...event, joined: true, saved: true }]);

    clearRssFeedCache();

    expect(getCachedRssEvent(event.id)).toBeUndefined();
  });
});
