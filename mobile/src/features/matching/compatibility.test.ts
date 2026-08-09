import { parseCompatibility, parseMatchContext } from './compatibility';

describe('eşleşme uyumluluğu', () => {
  const snapshot = {
    score: 76,
    calculatedAt: '2026-08-07T12:00:00.000Z',
    interests: {
      score: 80,
      commonCount: 2,
      myCount: 3,
      theirCount: 4,
      items: [{ id: 'interest-1', label: 'Caz' }],
    },
    upcoming: {
      score: 100,
      commonCount: 1,
      myCount: 1,
      theirCount: 1,
      items: [
        {
          id: 'event-1',
          title: 'Ortak konser',
          startAt: '2026-08-09T18:00:00.000Z',
          imageUrl: null,
        },
      ],
    },
    attended: {
      score: 0,
      commonCount: 0,
      myCount: 2,
      theirCount: 1,
      items: [],
    },
  };

  it('veritabanı snapshotını güvenli domain modeline dönüştürür', () => {
    expect(parseCompatibility(snapshot)).toEqual(snapshot);
  });

  it('eşleşme anındaki bağlamı ve ortak etkinlikleri korur', () => {
    expect(
      parseMatchContext({
        matchId: 'match-1',
        status: 'active',
        matchedAt: '2026-08-07T12:01:00.000Z',
        compatibility: snapshot,
        firstLiker: { id: 'user-1', name: 'Ada' },
        acceptedBy: { id: 'user-2', name: 'Deniz' },
        event: {
          id: 'event-1',
          title: 'Ortak konser',
          startAt: '2026-08-09T18:00:00.000Z',
          imageUrl: null,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        matchId: 'match-1',
        firstLiker: { id: 'user-1', name: 'Ada' },
        compatibility: expect.objectContaining({ score: 76 }),
      }),
    );
  });

  it('geçersiz eşleşme bağlamını göstermeyi reddeder', () => {
    expect(parseMatchContext({ compatibility: snapshot })).toBeNull();
  });
});
