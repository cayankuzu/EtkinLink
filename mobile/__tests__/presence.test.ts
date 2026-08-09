import {
  buildAppPresenceTopic,
  buildConversationPairKey,
  buildConversationTopic,
  hasOnlineAppPresence,
} from '../src/features/messages/presence';

describe('chat presence topics', () => {
  it('builds one stable conversation topic regardless of user order', () => {
    const left = '11111111-1111-4111-8111-111111111111';
    const right = '22222222-2222-4222-8222-222222222222';

    expect(buildConversationPairKey(left, right)).toBe(`${left}:${right}`);
    expect(buildConversationPairKey(right, left)).toBe(`${left}:${right}`);
    expect(buildConversationTopic(`${left}:${right}`)).toBe(
      `conversation:${left}:${right}`,
    );
    expect(buildAppPresenceTopic(right)).toBe(`presence:${right}`);
  });

  it('only treats an active app payload for the requested user as online', () => {
    const userId = '22222222-2222-4222-8222-222222222222';
    expect(
      hasOnlineAppPresence(
        {
          first: [
            {
              userId,
              kind: 'app',
              isOnline: true,
              updatedAt: '2026-08-09T00:00:00.000Z',
            },
          ],
        },
        userId,
      ),
    ).toBe(true);
    expect(
      hasOnlineAppPresence(
        {
          first: [
            {
              userId,
              kind: 'app',
              isOnline: false,
              updatedAt: '2026-08-09T00:00:00.000Z',
            },
          ],
        },
        userId,
      ),
    ).toBe(false);
  });
});
