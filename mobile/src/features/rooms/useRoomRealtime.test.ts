jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(),
    realtime: { setAuth: jest.fn() },
    removeChannel: jest.fn(),
  },
}));

import { supabase } from '@shared/lib/supabase';
import { act, renderHook } from '@testing-library/react-native';

import { useRoomRealtime } from './useRoomRealtime';

const mockChannel = supabase.channel as jest.Mock;
const mockSetAuth = supabase.realtime.setAuth as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as jest.Mock;

type BroadcastHandler = (event: {
  payload: { userId?: unknown; typing?: unknown };
}) => void;

function createRealtimeChannel() {
  let broadcastHandler: BroadcastHandler | null = null;
  const channel: {
    on: jest.Mock;
    send: jest.Mock;
    subscribe: jest.Mock;
  } = {
    on: jest.fn(),
    send: jest.fn(async () => 'ok'),
    subscribe: jest.fn(),
  };
  channel.on.mockImplementation(
    (
      type: string,
      _filter: unknown,
      callback: BroadcastHandler | (() => void),
    ) => {
      if (type === 'broadcast') broadcastHandler = callback as BroadcastHandler;
      return channel;
    },
  );
  channel.subscribe.mockReturnValue(channel);
  return {
    channel,
    emitTyping: (payload: { userId?: unknown; typing?: unknown }) =>
      broadcastHandler?.({ payload }),
  };
}

describe('useRoomRealtime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    jest.clearAllMocks();
    mockSetAuth.mockResolvedValue(undefined);
    mockRemoveChannel.mockResolvedValue('ok');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('kullanıcı yokken private kanal veya timer oluşturmaz', async () => {
    const { result } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: null,
        onMessage: jest.fn(),
      }),
    );

    await act(() => result.current.notifyTyping('Merhaba'));

    expect(mockChannel).not.toHaveBeenCalled();
    expect(result.current.typingUserIds).toEqual([]);
  });

  it('private oda kanalını mesaj filtresi ve typing broadcastıyla kurar', async () => {
    const realtime = createRealtimeChannel();
    mockChannel.mockReturnValue(realtime.channel);
    const onMessage = jest.fn();

    const { unmount } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: 'user-1',
        onMessage,
      }),
    );

    expect(mockSetAuth).toHaveBeenCalledTimes(1);
    expect(mockChannel).toHaveBeenCalledWith('room:event-1', {
      config: { private: true, broadcast: { self: false } },
    });
    expect(realtime.channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        table: 'room_messages',
        filter: 'event_id=eq.event-1',
      }),
      onMessage,
    );
    expect(realtime.channel.subscribe).toHaveBeenCalledTimes(1);

    await unmount();
    expect(mockRemoveChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it('uzak typing durumunu ekler ve stop olayında temizler', async () => {
    const realtime = createRealtimeChannel();
    mockChannel.mockReturnValue(realtime.channel);
    const { result } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: 'user-1',
        onMessage: jest.fn(),
      }),
    );

    await act(() => realtime.emitTyping({ userId: 'user-2', typing: true }));
    await act(() => realtime.emitTyping({ userId: 'user-2', typing: true }));
    await act(() => realtime.emitTyping({ userId: 'user-1', typing: true }));
    await act(() => realtime.emitTyping({ userId: 42, typing: true }));
    expect(result.current.typingUserIds).toEqual(['user-2']);

    await act(() => realtime.emitTyping({ userId: 'user-2', typing: false }));
    expect(result.current.typingUserIds).toEqual([]);
  });

  it('uzak typing heartbeat kesilirse 3.5 saniyelik sona erme timerı kurar', async () => {
    const realtime = createRealtimeChannel();
    mockChannel.mockReturnValue(realtime.channel);
    const { result } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: 'user-1',
        onMessage: jest.fn(),
      }),
    );
    const timeout = jest.spyOn(global, 'setTimeout');

    await act(() => realtime.emitTyping({ userId: 'user-3', typing: true }));
    expect(result.current.typingUserIds).toEqual(['user-3']);
    const expiry = timeout.mock.calls.find(([, delay]) => delay === 3_500)?.[0];
    expect(expiry).toBeInstanceOf(Function);
    timeout.mockRestore();
  });

  it('yazma başlangıcını yayınlar, spamı sınırlar ve idle sonunda durdurur', async () => {
    const realtime = createRealtimeChannel();
    mockChannel.mockReturnValue(realtime.channel);
    const { result } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: 'user-1',
        onMessage: jest.fn(),
      }),
    );

    await act(() => result.current.notifyTyping('M'));
    await act(async () => Promise.resolve());
    expect(realtime.channel.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'typing',
      payload: {
        userId: 'user-1',
        typing: true,
        at: new Date('2026-08-19T12:00:00.000Z').getTime(),
      },
    });

    await act(() => result.current.notifyTyping('Me'));
    expect(realtime.channel.send).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(2_500));
    await act(async () => Promise.resolve());

    expect(realtime.channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ typing: false }),
      }),
    );
  });

  it('boş metinde typing durumunu hemen durdurur ve cleanup son durumu yayınlar', async () => {
    const realtime = createRealtimeChannel();
    mockChannel.mockReturnValue(realtime.channel);
    const { result, unmount } = await renderHook(() =>
      useRoomRealtime({
        eventId: 'event-1',
        currentUserId: 'user-1',
        onMessage: jest.fn(),
      }),
    );

    await act(() => result.current.notifyTyping('Yazıyorum'));
    await act(async () => Promise.resolve());
    await act(() => result.current.notifyTyping('   '));
    await act(async () => Promise.resolve());
    expect(realtime.channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ typing: false }),
      }),
    );

    await act(() => result.current.notifyTyping('Tekrar'));
    await unmount();
    expect(realtime.channel.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ typing: false }),
      }),
    );
    expect(mockRemoveChannel).toHaveBeenCalledWith(realtime.channel);
  });
});
