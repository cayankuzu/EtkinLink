import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import type { LikedCandidate } from './matchingService';

type LikeCursor = { likedAt: string; userId: string } | null;

type LikePage = {
  items: LikedCandidate[];
  nextCursor: LikeCursor;
};

type LikePages = InfiniteData<LikePage, LikeCursor>;

export type PendingLikesSnapshot = {
  incoming: LikePages | undefined;
  outgoing: LikePages | undefined;
};

const incomingKey = ['incoming-liked-candidates'] as const;
const outgoingKey = ['liked-candidates'] as const;

function withoutCandidate(
  data: LikePages | undefined,
  candidateId: string,
): LikePages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map(page => ({
      ...page,
      items: page.items.filter(item => item.candidate.id !== candidateId),
    })),
  };
}

/**
 * WMatch-style immediate suppression: once a person has received a final
 * swipe decision, remove them from every pending-like surface in one frame.
 */
export function suppressCandidateFromPendingLikes(
  queryClient: QueryClient,
  candidateId: string,
): PendingLikesSnapshot {
  const snapshot: PendingLikesSnapshot = {
    incoming: queryClient.getQueryData<LikePages>(incomingKey),
    outgoing: queryClient.getQueryData<LikePages>(outgoingKey),
  };

  queryClient.setQueryData<LikePages>(incomingKey, current =>
    withoutCandidate(current, candidateId),
  );
  queryClient.setQueryData<LikePages>(outgoingKey, current =>
    withoutCandidate(current, candidateId),
  );
  return snapshot;
}

export function restorePendingLikes(
  queryClient: QueryClient,
  snapshot: PendingLikesSnapshot,
) {
  if (snapshot.incoming)
    queryClient.setQueryData(incomingKey, snapshot.incoming);
  if (snapshot.outgoing)
    queryClient.setQueryData(outgoingKey, snapshot.outgoing);
}
