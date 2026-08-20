jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(),
    removeChannel: jest.fn(),
    rpc: jest.fn(),
  },
}));
jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

import { createSupabaseBuilder } from '../../test/supabaseMock';
import {
  listRoomMessages,
  listRooms,
  markRoomRead,
  sendRoomMessage,
  submitRoomReport,
  subscribeToRoomListChanges,
} from './roomService';

const mockRpc = jest.mocked(supabase.rpc);
const mockChannel = jest.mocked(supabase.channel);
const mockRemoveChannel = jest.mocked(supabase.removeChannel);
const mockSignedUrls = jest.mocked(getSignedProfilePhotoUrls);

function roomRow(index: number) {
  return {
    event_id: `event-${index}`,
    title: `Etkinlik ${index}`,
    start_at: '2026-09-01T18:00:00.000Z',
    end_at: '2026-09-01T21:00:00.000Z',
    image_url: null,
    city: 'İstanbul',
    venue: 'Salon',
    joined_at: `2026-08-19T10:${String(index).padStart(2, '0')}:00.000Z`,
    matching_enabled: true,
    room_open: true,
    unread_count: '2',
    last_message: 'Merhaba',
    last_message_is_mine: false,
    last_message_sender_name: 'Deniz',
    last_message_at: '2026-08-19T11:00:00.000Z',
  };
}

function messageRow(index: number) {
  return {
    id: `message-${index}`,
    event_id: 'event-1',
    sender_id: 'user-2',
    sender_name: 'Deniz',
    sender_photo_path: index === 0 ? 'user-2/photo.jpg' : null,
    body: `Mesaj ${index}`,
    client_message_id: `client-${index}`,
    created_at: `2026-08-19T11:${String(index).padStart(2, '0')}:00.000Z`,
  };
}

describe('roomService davranış regresyonları', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignedUrls.mockResolvedValue(
      new Map([['user-2/photo.jpg', 'https://cdn.example/photo.jpg']]),
    );
  });

  it('oda listesini map eder, sayıları normalize eder ve tam sayfada cursor üretir', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => roomRow(index));
    const builder = createSupabaseBuilder({ data: rows, error: null });
    mockRpc.mockReturnValue(builder as never);
    const signal = new AbortController().signal;

    const page = await listRooms(null, signal);

    expect(page.items).toHaveLength(30);
    expect(page.items[0]).toMatchObject({
      eventId: 'event-0',
      unreadCount: 2,
      lastMessage: 'Merhaba',
    });
    expect(page.nextCursor).toEqual({
      joinedAt: '2026-08-19T10:29:00.000Z',
      eventId: 'event-29',
    });
    expect(builder.abortSignal).toHaveBeenCalledWith(signal);
  });

  it('mesajları signed avatarla map eder ve tam thread sayfasında cursor üretir', async () => {
    const rows = Array.from({ length: 35 }, (_, index) => messageRow(index));
    mockRpc.mockReturnValue(
      createSupabaseBuilder({ data: rows, error: null }) as never,
    );

    const page = await listRoomMessages('event-1');

    expect(page.items[0]).toMatchObject({
      id: 'message-0',
      senderPhotoUrl: 'https://cdn.example/photo.jpg',
      status: 'sent',
    });
    expect(page.items[1]?.senderPhotoUrl).toBeNull();
    expect(page.nextCursor).toEqual({
      createdAt: '2026-08-19T11:34:00.000Z',
      id: 'message-34',
    });
  });

  it('send/read/report RPC sözleşmelerini ve hata iletimini korur', async () => {
    const sent = messageRow(1);
    mockRpc
      .mockResolvedValueOnce({ data: sent, error: null } as never)
      .mockResolvedValueOnce({ data: null, error: null } as never)
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'rapor reddedildi' },
      } as never);

    await expect(
      sendRoomMessage('event-1', 'Merhaba', 'client-1'),
    ).resolves.toBe(sent);
    await expect(markRoomRead('event-1')).resolves.toBeUndefined();
    await expect(submitRoomReport('event-1')).rejects.toMatchObject({
      message: 'rapor reddedildi',
    });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'send_room_message', {
      target_event_id: 'event-1',
      message_body: 'Merhaba',
      client_message_id: 'client-1',
    });
  });

  it('oda listesi realtime aboneliğini iki tabloya kurar ve temizler', () => {
    const channel = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    channel.on.mockReturnValue(channel);
    channel.subscribe.mockReturnValue(channel);
    mockChannel.mockReturnValue(channel as never);
    const onChange = jest.fn();

    const unsubscribe = subscribeToRoomListChanges(onChange);

    expect(channel.on).toHaveBeenCalledTimes(2);
    expect(channel.subscribe).toHaveBeenCalled();
    unsubscribe();
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel);
  });

  it('liste RPC hatasını boş state gibi göstermeden iletir', async () => {
    mockRpc.mockReturnValue(
      createSupabaseBuilder({
        data: [],
        error: { message: 'oda listesi reddedildi' },
      }) as never,
    );
    await expect(listRooms()).rejects.toMatchObject({
      message: 'oda listesi reddedildi',
    });
  });
});
