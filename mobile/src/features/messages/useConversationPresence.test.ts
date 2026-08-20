jest.mock('@shared/lib/supabase', () => ({
  supabase: { channel: jest.fn() },
}));

jest.mock('./realtimeChannel', () => ({
  removeOrphanedRealtimeTopic: jest.fn(async () => undefined),
  removeRealtimeChannel: jest.fn(async () => undefined),
}));

import { supabase } from '@shared/lib/supabase';
import { act, renderHook } from '@testing-library/react-native';

import {
  removeOrphanedRealtimeTopic,
  removeRealtimeChannel,
} from './realtimeChannel';
import { useConversationPresence } from './useConversationPresence';

const mockSupabaseChannel = supabase.channel as jest.Mock;
const mockRemoveOrphanedRealtimeTopic = jest.mocked(
  removeOrphanedRealtimeTopic,
);
const mockRemoveRealtimeChannel = jest.mocked(removeRealtimeChannel);

type PresenceState = Record<
  string,
  { userId: string; kind: 'app'; isOnline: boolean; updatedAt: string }[]
>;
type TypingPayload = {
  userId: string;
  isTyping: boolean;
  updatedAt: string;
};

function createChannelHarness() {
  let presenceState: PresenceState = {};
  const presenceListeners: (() => void)[] = [];
  let typingListener: ((event: { payload: TypingPayload }) => void) | null =
    null;

  const typingChannel: {
    on: jest.Mock;
    send: jest.Mock;
    subscribe: jest.Mock;
  } = {
    on: jest.fn(),
    send: jest.fn(async () => 'ok'),
    subscribe: jest.fn(),
  };
  typingChannel.on.mockImplementation(
    (
      type: string,
      _filter: unknown,
      listener: (event: { payload: TypingPayload }) => void,
    ) => {
      if (type === 'broadcast') typingListener = listener;
      return typingChannel;
    },
  );
  typingChannel.subscribe.mockImplementation(
    (listener?: (status: string) => void) => {
      listener?.('SUBSCRIBED');
      return typingChannel;
    },
  );
  const presenceChannel: {
    on: jest.Mock;
    presenceState: jest.Mock;
    subscribe: jest.Mock;
  } = {
    on: jest.fn(),
    presenceState: jest.fn(() => presenceState),
    subscribe: jest.fn(),
  };
  presenceChannel.on.mockImplementation(
    (_type: string, _filter: unknown, listener: () => void) => {
      presenceListeners.push(listener);
      return presenceChannel;
    },
  );
  presenceChannel.subscribe.mockReturnValue(presenceChannel);
  mockSupabaseChannel.mockImplementation((topic: string) =>
    topic.startsWith('conversation:') ? typingChannel : presenceChannel,
  );
  return {
    presenceChannel,
    typingChannel,
    emitPresence: (nextState: PresenceState) => {
      presenceState = nextState;
      presenceListeners.forEach(listener => listener());
    },
    emitTyping: (payload: TypingPayload) => typingListener?.({ payload }),
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useConversationPresence', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    jest.clearAllMocks();
  });

  afterEach(() => jest.useRealTimers());

  it('kimlik veya etkinleştirme yoksa kanal oluşturmaz ve durumları kapalı tutar', async () => {
    const { result } = await renderHook(() =>
      useConversationPresence({
        currentUserId: null,
        otherUserId: 'user-2',
        enabled: false,
      }),
    );

    expect(result.current).toMatchObject({
      otherOnline: false,
      otherTyping: false,
    });
    expect(mockSupabaseChannel).not.toHaveBeenCalled();
  });

  it('yetim kanalları temizleyip private typing ve presence kanallarını kurar', async () => {
    const realtime = createChannelHarness();
    const { result, unmount } = await renderHook(() =>
      useConversationPresence({
        currentUserId: 'presence-a',
        otherUserId: 'presence-b',
      }),
    );
    await flushEffects();

    expect(mockRemoveOrphanedRealtimeTopic.mock.calls).toEqual([
      ['conversation:presence-a:presence-b'],
      ['presence:presence-b'],
    ]);
    expect(mockSupabaseChannel.mock.calls).toEqual([
      [
        'conversation:presence-a:presence-b',
        { config: { private: true, broadcast: { self: true, ack: false } } },
      ],
      ['presence:presence-b', { config: { private: true } }],
    ]);

    await act(() =>
      realtime.emitPresence({
        connection: [
          {
            userId: 'presence-b',
            kind: 'app',
            isOnline: true,
            updatedAt: '2026-08-19T12:00:00.000Z',
          },
        ],
      }),
    );
    expect(result.current.otherOnline).toBe(true);

    await unmount();
  });

  it('yalnızca karşı kullanıcının typing olayını izler ve stop olayında temizler', async () => {
    const realtime = createChannelHarness();
    const { result, unmount } = await renderHook(() =>
      useConversationPresence({
        currentUserId: 'typing-a',
        otherUserId: 'typing-b',
      }),
    );
    await flushEffects();
    const timestamp = '2026-08-19T12:00:00.000Z';

    await act(() =>
      realtime.emitTyping({
        userId: 'typing-a',
        isTyping: true,
        updatedAt: timestamp,
      }),
    );
    expect(result.current.otherTyping).toBe(false);
    await act(() =>
      realtime.emitTyping({
        userId: 'typing-b',
        isTyping: true,
        updatedAt: timestamp,
      }),
    );
    expect(result.current.otherTyping).toBe(true);
    await act(() =>
      realtime.emitTyping({
        userId: 'typing-b',
        isTyping: false,
        updatedAt: timestamp,
      }),
    );
    expect(result.current.otherTyping).toBe(false);

    await unmount();
  });

  it('yerel typing durumunu heartbeat ile yayınlar ve idle sonunda false gönderir', async () => {
    const realtime = createChannelHarness();
    const { result, unmount } = await renderHook(() =>
      useConversationPresence({
        currentUserId: 'heartbeat-a',
        otherUserId: 'heartbeat-b',
      }),
    );
    await flushEffects();

    await act(() => result.current.setTyping(true));
    await flushEffects();
    expect(realtime.typingChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          userId: 'heartbeat-a',
          isTyping: true,
        }),
      }),
    );

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(
      realtime.typingChannel.send.mock.calls.filter(
        (call: unknown[]) =>
          (call[0] as { payload: { isTyping: boolean } }).payload.isTyping ===
          true,
      ),
    ).toHaveLength(2);

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(realtime.typingChannel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ isTyping: false }),
      }),
    );

    await unmount();
  });

  it('aynı kullanıcı çifti için tek controller paylaşır ve son consumer sonrası kaldırır', async () => {
    const realtime = createChannelHarness();
    const first = await renderHook(() =>
      useConversationPresence({
        currentUserId: 'shared-a',
        otherUserId: 'shared-b',
        publishTyping: false,
      }),
    );
    const second = await renderHook(() =>
      useConversationPresence({
        currentUserId: 'shared-a',
        otherUserId: 'shared-b',
        publishTyping: false,
      }),
    );
    await flushEffects();

    expect(mockSupabaseChannel).toHaveBeenCalledTimes(2);
    await first.unmount();
    await act(async () => {
      jest.advanceTimersByTime(1_500);
      await Promise.resolve();
    });
    expect(mockRemoveRealtimeChannel).not.toHaveBeenCalled();

    await second.unmount();
    await act(async () => {
      jest.advanceTimersByTime(1_500);
      await Promise.resolve();
    });
    expect(mockRemoveRealtimeChannel.mock.calls).toEqual([
      [realtime.typingChannel],
      [realtime.presenceChannel],
    ]);
  });
});
