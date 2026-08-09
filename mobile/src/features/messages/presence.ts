export type AppPresencePayload = {
  userId: string;
  kind: 'app';
  isOnline: boolean;
  updatedAt: string;
};

export type AppPresenceSnapshot = Record<string, AppPresencePayload[]>;

export type TypingBroadcastPayload = {
  userId: string;
  isTyping: boolean;
  updatedAt: string;
};

export function buildAppPresenceTopic(userId: string): string {
  return `presence:${userId}`;
}

export function buildConversationPairKey(
  leftUserId: string,
  rightUserId: string,
): string {
  return leftUserId < rightUserId
    ? `${leftUserId}:${rightUserId}`
    : `${rightUserId}:${leftUserId}`;
}

export function buildConversationTopic(pairKey: string): string {
  return `conversation:${pairKey}`;
}

export function hasOnlineAppPresence(
  state: AppPresenceSnapshot,
  userId: string,
): boolean {
  return Object.values(state)
    .flat()
    .some(
      entry =>
        entry.kind === 'app' &&
        entry.userId === userId &&
        entry.isOnline === true,
    );
}
