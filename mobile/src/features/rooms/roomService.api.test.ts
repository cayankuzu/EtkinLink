jest.mock('@shared/lib/ids', () => ({
  createClientId: jest.fn(),
}));
jest.mock('@shared/lib/network', () => ({
  applyAbortSignal: jest.fn(request => request),
}));
jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));
jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { createClientId } from '@shared/lib/ids';
import { applyAbortSignal } from '@shared/lib/network';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

import {
  listRoomMessages,
  listRooms,
  markRoomRead,
  sendRoomMessage,
  submitRoomReport,
  subscribeToRoomListChanges,
} from './roomService';

const mockCreateClientId = jest.mocked(createClientId);
const mockApplyAbortSignal = jest.mocked(applyAbortSignal);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);
const mockRpc = supabase.rpc as jest.Mock;
const mockChannel = supabase.channel as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as jest.Mock;

function roomRow(index = 0) {
  return {
    event_id: `event-${index}`,
    title: `Etkinlik ${index}`,
    start_at: '2026-09-01T18:00:00.000Z',
    end_at: '2026-09-01T21:00:00.000Z',
    image_url: null,
    city: 'Istanbul',
    venue: 'Salon',
    joined_at: `2026-08-30T10:${String(index).padStart(2, '0')}:00.000Z`,
    matching_enabled: true,
    room_open: true,
    unread_count: '2',
    last_message: null,
    last_message_is_mine: null,
    last_message_sender_name: null,
    last_message_at: null,
  };
}

function messageRow(index: number, senderPhotoPath: string | null = null) {
  return {
    id: `message-${index}`,
    event_id: 'event-1',
    sender_id: `user-${index}`,
    sender_name: `User ${index}`,
    sender_photo_path: senderPhotoPath,
    body: `Mesaj ${index}`,
    client_message_id: `client-${index}`,
    created_at: `2026-08-30T12:${String(index).padStart(2, '0')}:00.000Z`,
  };
}

describe('roomService API davranislari', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedUrls.mockResolvedValue(new Map());
    mockCreateClientId.mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('odalari cursor olmadan map eder ve kisa sayfayi sonlandirir', async () => {
    const signal = new AbortController().signal;
    mockRpc.mockResolvedValueOnce({ data: [roomRow()], error: null });

    await expect(listRooms(null, signal)).resolves.toEqual({
      items: [
        expect.objectContaining({
          eventId: 'event-0',
          unreadCount: 2,
          state: expect.any(String),
        }),
      ],
      nextCursor: null,
    });

    expect(mockRpc).toHaveBeenCalledWith('list_joined_rooms', {
      page_size: 30,
      cursor_joined_at: null,
      cursor_event_id: null,
    });
    expect(mockApplyAbortSignal).toHaveBeenCalledWith(
      expect.anything(),
      signal,
    );
  });

  it('dolu oda sayfasinda sonraki cursoru kurar ve servis hatasini iletir', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => roomRow(index));
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });

    await expect(
      listRooms({ joinedAt: 'cursor-date', eventId: 'cursor-event' }),
    ).resolves.toMatchObject({
      items: expect.any(Array),
      nextCursor: {
        joinedAt: rows.at(-1)?.joined_at,
        eventId: rows.at(-1)?.event_id,
      },
    });
    expect(mockRpc).toHaveBeenLastCalledWith('list_joined_rooms', {
      page_size: 30,
      cursor_joined_at: 'cursor-date',
      cursor_event_id: 'cursor-event',
    });

    const error = new Error('rooms unavailable');
    mockRpc.mockResolvedValueOnce({ data: null, error });
    await expect(listRooms()).rejects.toBe(error);
  });

  it('mesaj fotograflarinin signed URL sonucunu ve kisa sayfayi map eder', async () => {
    const rows = [
      messageRow(1, 'user-1/photo.jpg'),
      messageRow(2, 'user-2/missing.jpg'),
      messageRow(3),
    ];
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });
    mockSignedUrls.mockResolvedValueOnce(
      new Map([['user-1/photo.jpg', 'https://cdn.example/photo.jpg']]),
    );

    const result = await listRoomMessages('event-1');

    expect(result.nextCursor).toBeNull();
    expect(result.items.map(item => item.senderPhotoUrl)).toEqual([
      'https://cdn.example/photo.jpg',
      null,
      null,
    ]);
    expect(result.items.every(item => item.status === 'sent')).toBe(true);
    expect(mockSignedUrls).toHaveBeenCalledWith([
      'user-1/photo.jpg',
      'user-2/missing.jpg',
    ]);
  });

  it('dolu mesaj sayfasinda cursoru kurar ve okuma hatasini iletir', async () => {
    const rows = Array.from({ length: 35 }, (_, index) => messageRow(index));
    const signal = new AbortController().signal;
    mockRpc.mockResolvedValueOnce({ data: rows, error: null });

    await expect(
      listRoomMessages(
        'event-1',
        { createdAt: 'cursor-date', id: 'cursor-message' },
        signal,
      ),
    ).resolves.toMatchObject({
      nextCursor: {
        createdAt: rows.at(-1)?.created_at,
        id: rows.at(-1)?.id,
      },
    });
    expect(mockRpc).toHaveBeenLastCalledWith('list_room_messages', {
      target_event_id: 'event-1',
      page_size: 35,
      cursor_created_at: 'cursor-date',
      cursor_message_id: 'cursor-message',
    });
    expect(mockApplyAbortSignal).toHaveBeenLastCalledWith(
      expect.anything(),
      signal,
    );

    const error = new Error('messages unavailable');
    mockRpc.mockResolvedValueOnce({ data: null, error });
    await expect(listRoomMessages('event-1')).rejects.toBe(error);
  });

  it('mesaj gonderme ve okundu isaretleme basari/hata sonuclarini korur', async () => {
    const sent = { id: 'message-1', body: 'Merhaba' };
    mockRpc.mockResolvedValueOnce({ data: sent, error: null });
    await expect(
      sendRoomMessage('event-1', 'Merhaba', 'client-1'),
    ).resolves.toBe(sent);

    const sendError = new Error('send rejected');
    mockRpc.mockResolvedValueOnce({ data: null, error: sendError });
    await expect(
      sendRoomMessage('event-1', 'Merhaba', 'client-2'),
    ).rejects.toBe(sendError);

    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(markRoomRead('event-1')).resolves.toBeUndefined();

    const readError = new Error('read state rejected');
    mockRpc.mockResolvedValueOnce({ data: null, error: readError });
    await expect(markRoomRead('event-1')).rejects.toBe(readError);
  });

  it('oda listesi realtime aboneligini kurar ve kaldirir', () => {
    const on = jest.fn();
    const subscribe = jest.fn();
    const channel = { on, subscribe };
    on.mockReturnValue(channel);
    subscribe.mockReturnValue(channel);
    mockChannel.mockReturnValue(channel);
    const onChange = jest.fn();

    const unsubscribe = subscribeToRoomListChanges(onChange);

    expect(mockChannel).toHaveBeenCalledWith('joined-rooms-list');
    expect(on).toHaveBeenCalledTimes(2);
    expect(subscribe).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
  });

  it('oda raporunda varsayilan veya verilen idempotency anahtarini kullanir', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(submitRoomReport('event-1')).resolves.toBeUndefined();
    expect(mockCreateClientId).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenLastCalledWith(
      'submit_room_report',
      expect.objectContaining({
        target_event_id: 'event-1',
        client_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );

    const error = new Error('report rejected');
    mockRpc.mockResolvedValueOnce({ data: null, error });
    await expect(
      submitRoomReport('event-1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ).rejects.toBe(error);
    expect(mockCreateClientId).toHaveBeenCalledTimes(1);
  });
});
