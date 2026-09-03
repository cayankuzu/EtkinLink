jest.mock('@features/messages/messageService', () => ({
  sendDirectMessage: jest.fn(),
}));

jest.mock('@features/rooms/roomService', () => ({
  sendRoomMessage: jest.fn(),
}));

jest.mock('@shared/lib/chatOutbox', () => ({
  flushAllOutbox: jest.fn(),
}));

jest.mock('@shared/lib/telemetry', () => ({
  captureAppError: jest.fn(),
  warnRedacted: jest.fn(),
}));

import { sendDirectMessage } from '@features/messages/messageService';
import { sendRoomMessage } from '@features/rooms/roomService';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { flushAllOutbox, type OutboxMessage } from '@shared/lib/chatOutbox';
import { captureAppError } from '@shared/lib/telemetry';
import { act, render } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { OutboxSyncController } from './OutboxSyncController';

const mockSendDirectMessage = jest.mocked(sendDirectMessage);
const mockSendRoomMessage = jest.mocked(sendRoomMessage);
const mockFlushAllOutbox = jest.mocked(flushAllOutbox);
const mockCaptureAppError = jest.mocked(captureAppError);

function outboxMessage(kind: 'direct' | 'room'): OutboxMessage {
  return {
    ownerId: 'user-1',
    kind,
    contextId: kind === 'direct' ? 'match-1' : 'event-1',
    clientMessageId: `${kind}-client-1`,
    body: 'Merhaba',
    createdAt: '2026-08-19T12:00:00.000Z',
    attempt: 0,
    nextAttemptAt: '2026-08-19T12:00:00.000Z',
  };
}

describe('OutboxSyncController', () => {
  let networkListener: ((state: NetInfoState) => void) | null;
  let appStateListener: ((state: AppStateStatus) => void) | null;
  const unsubscribeNetwork = jest.fn();
  const removeAppState = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    networkListener = null;
    appStateListener = null;
    mockFlushAllOutbox.mockResolvedValue();
    jest.spyOn(NetInfo, 'addEventListener').mockImplementation(listener => {
      networkListener = listener;
      return unsubscribeNetwork;
    });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, listener) => {
        appStateListener = listener;
        return { remove: removeAppState };
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('mount sırasında kuyruğu işler ve direct/room mesajını doğru idempotency anahtarıyla yollar', async () => {
    const view = await render(<OutboxSyncController userId="user-1" />);
    await act(async () => Promise.resolve());

    expect(mockFlushAllOutbox).toHaveBeenCalledTimes(1);
    const deliver = mockFlushAllOutbox.mock.calls[0]?.[1];
    expect(deliver).toBeDefined();
    await deliver?.(outboxMessage('direct'));
    await deliver?.(outboxMessage('room'));

    expect(mockSendDirectMessage).toHaveBeenCalledWith(
      'match-1',
      'Merhaba',
      'direct-client-1',
    );
    expect(mockSendRoomMessage).toHaveBeenCalledWith(
      'event-1',
      'Merhaba',
      'room-client-1',
    );
    await view.unmount();
  });

  it('yalnızca gerçek internet geri geldiğinde yeniden flush eder', async () => {
    const view = await render(<OutboxSyncController userId="user-1" />);
    await act(async () => Promise.resolve());

    await act(() =>
      networkListener?.({
        isConnected: false,
        isInternetReachable: false,
        type: 'none',
        details: null,
      } as unknown as NetInfoState),
    );
    await act(() =>
      networkListener?.({
        isConnected: true,
        isInternetReachable: false,
        type: 'wifi',
        details: null,
      } as unknown as NetInfoState),
    );
    expect(mockFlushAllOutbox).toHaveBeenCalledTimes(1);

    await act(() =>
      networkListener?.({
        isConnected: true,
        isInternetReachable: true,
        type: 'wifi',
        details: null,
      } as unknown as NetInfoState),
    );
    expect(mockFlushAllOutbox).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it('uygulama yalnızca active durumuna dönünce yeniden flush eder', async () => {
    const view = await render(<OutboxSyncController userId="user-1" />);
    await act(async () => Promise.resolve());

    await act(() => appStateListener?.('background'));
    expect(mockFlushAllOutbox).toHaveBeenCalledTimes(1);
    await act(() => appStateListener?.('active'));
    expect(mockFlushAllOutbox).toHaveBeenCalledTimes(2);
    await view.unmount();
  });

  it('flush hatasını telemetriye iletir ama bir dakika içinde tekrar spamlamaz', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    const error = new Error('secure storage unavailable');
    mockFlushAllOutbox.mockRejectedValue(error);
    const view = await render(<OutboxSyncController userId="user-1" />);
    await act(async () => Promise.resolve());

    expect(mockCaptureAppError).toHaveBeenCalledWith(error, {
      operation: 'outbox.flush',
    });
    await act(() => appStateListener?.('active'));
    await act(async () => Promise.resolve());
    expect(mockCaptureAppError).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await act(() => appStateListener?.('active'));
    await act(async () => Promise.resolve());
    expect(mockCaptureAppError).toHaveBeenCalledTimes(2);
    await view.unmount();
    jest.useRealTimers();
  });

  it('unmount sırasında network ve AppState listenerlarını kaldırır', async () => {
    const view = await render(<OutboxSyncController userId="user-1" />);

    await view.unmount();

    expect(unsubscribeNetwork).toHaveBeenCalledTimes(1);
    expect(removeAppState).toHaveBeenCalledTimes(1);
  });
});
