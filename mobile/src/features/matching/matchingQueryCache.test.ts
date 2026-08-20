import { QueryClient } from '@tanstack/react-query';

import {
  restorePendingLikes,
  suppressCandidateFromPendingLikes,
} from './matchingQueryCache';
import type { LikedCandidate } from './matchingService';

function likedCandidate(id: string): LikedCandidate {
  return {
    candidate: {
      id,
      fullName: `Kullanıcı ${id}`,
      username: `user_${id}`,
      age: 24,
      gender: 'woman',
      bio: '',
      city: 'İstanbul',
      joinedAt: '2026-08-09T12:00:00.000Z',
      photos: [],
      interests: [],
    },
    eventId: 'event-id',
    eventTitle: 'Etkinlik',
    likedAt: '2026-08-09T12:00:00.000Z',
    matched: false,
  };
}

function page(items: LikedCandidate[]) {
  return {
    pages: [{ items, nextCursor: null }],
    pageParams: [null],
  };
}

describe('pending matching likes cache', () => {
  it('suppresses a decided person from outgoing and incoming pools at once', () => {
    const queryClient = new QueryClient();
    const decided = likedCandidate('decided');
    const waiting = likedCandidate('waiting');
    queryClient.setQueryData(['liked-candidates'], page([decided, waiting]));
    queryClient.setQueryData(
      ['incoming-liked-candidates'],
      page([waiting, decided]),
    );

    suppressCandidateFromPendingLikes(queryClient, decided.candidate.id);

    expect(
      queryClient
        .getQueryData<ReturnType<typeof page>>(['liked-candidates'])
        ?.pages.flatMap(result => result.items),
    ).toEqual([waiting]);
    expect(
      queryClient
        .getQueryData<ReturnType<typeof page>>(['incoming-liked-candidates'])
        ?.pages.flatMap(result => result.items),
    ).toEqual([waiting]);
    queryClient.clear();
  });

  it('restores both pools when the server rejects the swipe', () => {
    const queryClient = new QueryClient();
    const decided = likedCandidate('decided');
    queryClient.setQueryData(['liked-candidates'], page([decided]));
    queryClient.setQueryData(['incoming-liked-candidates'], page([decided]));

    const snapshot = suppressCandidateFromPendingLikes(
      queryClient,
      decided.candidate.id,
    );
    restorePendingLikes(queryClient, snapshot);

    expect(
      queryClient.getQueryData<ReturnType<typeof page>>(['liked-candidates'])
        ?.pages[0]?.items,
    ).toEqual([decided]);
    expect(
      queryClient.getQueryData<ReturnType<typeof page>>([
        'incoming-liked-candidates',
      ])?.pages[0]?.items,
    ).toEqual([decided]);
    queryClient.clear();
  });
});
