jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(),
    from: jest.fn(),
    removeChannel: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('@shared/lib/profilePhotoUrls', () => ({
  getSignedProfilePhotoUrls: jest.fn(),
}));

import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

import {
  blockUser,
  deleteMatchChat,
  endMatch,
  getMatch,
  listDirectMessages,
  listMatches,
  markMatchRead,
  sendDirectMessage,
  subscribeToDirectMessages,
  subscribeToMatchList,
  unblockUser,
} from './messageService';

const mockRpc = supabase.rpc as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockChannel = supabase.channel as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as jest.Mock;
const mockGetSignedProfilePhotoUrls =
  getSignedProfilePhotoUrls as jest.MockedFunction<
    typeof getSignedProfilePhotoUrls
  >;

function createQueryResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  const query = {
    abortSignal: jest.fn(),
    eq: jest.fn(),
    limit: jest.fn(),
    or: jest.fn(),
    order: jest.fn(),
    select: jest.fn(),
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  query.abortSignal.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

function createChannel() {
  const channel = {
    on: jest.fn(),
    subscribe: jest.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return channel;
}

const matchContext = {
  match_id: 'match-1',
  event_id: 'event-1',
  event_title: 'Konser',
  other_user_id: 'user-2',
  other_full_name: 'Deniz',
  other_username: 'deniz',
  other_age: 27,
  other_gender: 'woman',
  other_bio: 'Müzik sever.',
  other_city: 'İstanbul',
  match_status: 'active',
  match_created_at: '2026-08-09T12:00:00.000Z',
  last_message: 'Merhaba',
  last_message_at: '2026-08-09T12:01:00.000Z',
  blocked_by_me: false,
  photo_ids: ['photo-0', 'photo-1'],
  photo_storage_paths: ['user/photo-0.jpg', 'user/photo-1.jpg'],
  photo_positions: [0, 1],
};

const directMessage = {
  id: 'message-1',
  match_id: 'match-1',
  sender_id: 'user-1',
  receiver_id: 'user-2',
  body: 'Merhaba',
  client_message_id: 'client-1',
  read_at: null,
  created_at: '2026-08-09T12:01:00.000Z',
};

describe('messageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedProfilePhotoUrls.mockResolvedValue(
      new Map([
        ['user/photo-0.jpg', 'https://cdn.example/photo-0.jpg'],
        ['user/photo-1.jpg', 'https://cdn.example/photo-1.jpg'],
      ]),
    );
  });

  it('eşleşmeleri fotoğrafları ve kararlı sayfalama imleciyle listeler', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      match_id: `match-${index}`,
      event_id: 'event-1',
      event_title: 'Konser',
      other_user_id: `user-${index}`,
      other_full_name: `Kişi ${index}`,
      other_username: `kisi${index}`,
      other_age: 25,
      other_gender: 'woman',
      other_bio: '',
      other_city: 'İstanbul',
      match_status: 'active',
      match_created_at: '2026-08-09T12:00:00.000Z',
      last_message: 'Selam',
      last_message_at: '2026-08-09T12:01:00.000Z',
      unread_count: index === 0 ? '2' : 0,
      activity_at: `2026-08-09T12:${String(index).padStart(2, '0')}:00.000Z`,
      other_primary_photo_path: index === 0 ? 'user/photo-0.jpg' : null,
    }));
    mockRpc.mockResolvedValue({ data: rows, error: null });

    const result = await listMatches('unread', {
      activityAt: '2026-08-01T00:00:00.000Z',
      matchId: 'previous-match',
    });

    expect(mockRpc).toHaveBeenCalledWith('list_matches', {
      status_filter: 'unread',
      page_size: 30,
      cursor_activity_at: '2026-08-01T00:00:00.000Z',
      cursor_match_id: 'previous-match',
    });
    expect(mockGetSignedProfilePhotoUrls).toHaveBeenCalledWith([
      'user/photo-0.jpg',
    ]);
    expect(result.items[0]).toMatchObject({
      id: 'match-0',
      unreadCount: 2,
      otherUser: { photos: [{ url: 'https://cdn.example/photo-0.jpg' }] },
    });
    expect(result.nextCursor).toEqual({
      activityAt: rows[29]?.activity_at,
      matchId: 'match-29',
    });
  });

  it('eşleşme listesi RPC hatasını sessizce yutmaz', async () => {
    const error = new Error('list failed');
    mockRpc.mockResolvedValue({ data: null, error });

    await expect(listMatches('all')).rejects.toBe(error);
    expect(mockGetSignedProfilePhotoUrls).not.toHaveBeenCalled();
  });

  it('sohbet başlığını tek bileşik RPC ve tek fotoğraf imzalama turuyla kurar', async () => {
    mockRpc.mockResolvedValue({ data: [matchContext], error: null });

    const match = await getMatch('match-1');

    expect(mockRpc).toHaveBeenCalledWith('get_chat_match_context', {
      target_match_id: 'match-1',
    });
    expect(match).toMatchObject({
      id: 'match-1',
      eventTitle: 'Konser',
      otherUser: {
        id: 'user-2',
        fullName: 'Deniz',
        photos: [
          { id: 'photo-0', position: 0 },
          { id: 'photo-1', position: 1 },
        ],
      },
    });
  });

  it('eksik profil alanlarını güvenli varsayılanlarla, bozuk fotoğraf dizisini atlayarak kurar', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          ...matchContext,
          other_full_name: null,
          other_username: null,
          other_bio: null,
          other_city: null,
          photo_ids: [],
          photo_positions: [],
        },
      ],
      error: null,
    });

    const match = await getMatch('match-1');

    expect(match.otherUser).toMatchObject({
      fullName: 'EtkinLink kullanıcısı',
      username: 'kullanici',
      bio: '',
      city: '',
      photos: [],
    });
  });

  it('yetkisiz veya silinmiş sohbet için kayıt dönmezse güvenli hata verir', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await expect(getMatch('hidden-match')).rejects.toThrow(
      'Eşleşme bulunamadı.',
    );
    expect(mockGetSignedProfilePhotoUrls).not.toHaveBeenCalled();
  });

  it('doğrudan mesajları imleç ve iptal sinyaliyle sayfalar', async () => {
    const rows = Array.from({ length: 35 }, (_, index) => ({
      ...directMessage,
      id: `message-${index}`,
      created_at: `2026-08-09T12:${String(index).padStart(2, '0')}:00.000Z`,
      read_at: index === 0 ? '2026-08-09T12:02:00.000Z' : null,
    }));
    const query = createQueryResult(rows);
    mockFrom.mockReturnValue(query);
    const controller = new AbortController();

    const result = await listDirectMessages(
      'match-1',
      { createdAt: '2026-08-01T00:00:00.000Z', id: 'message-old' },
      controller.signal,
    );

    expect(mockFrom).toHaveBeenCalledWith('direct_messages');
    expect(query.or).toHaveBeenCalledWith(
      'created_at.lt.2026-08-01T00:00:00.000Z,and(created_at.eq.2026-08-01T00:00:00.000Z,id.lt.message-old)',
    );
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
    expect(result.items[0]?.status).toBe('read');
    expect(result.items[1]?.status).toBe('sent');
    expect(result.nextCursor).toEqual({
      createdAt: rows[34]?.created_at,
      id: 'message-34',
    });
  });

  it('mesaj gönderimini alan modeline dönüştürür ve sunucu hatasını yayar', async () => {
    mockRpc.mockResolvedValueOnce({ data: directMessage, error: null });

    await expect(
      sendDirectMessage('match-1', 'Merhaba', 'client-1'),
    ).resolves.toMatchObject({
      id: 'message-1',
      matchId: 'match-1',
      status: 'sent',
    });
    expect(mockRpc).toHaveBeenCalledWith('send_direct_message', {
      target_match_id: 'match-1',
      message_body: 'Merhaba',
      client_message_id: 'client-1',
    });

    const error = new Error('send failed');
    mockRpc.mockResolvedValueOnce({ data: null, error });
    await expect(
      sendDirectMessage('match-1', 'Tekrar', 'client-2'),
    ).rejects.toBe(error);
  });

  it('okundu, bitir, engelle, engel kaldır ve sil eylemlerini doğru RPC sözleşmesiyle çağırır', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    await markMatchRead('match-1');
    await endMatch('match-1');
    await blockUser('user-2');
    await unblockUser('user-2');
    await deleteMatchChat('match-1', 'block');

    expect(mockRpc.mock.calls).toEqual([
      ['mark_match_read', { target_match_id: 'match-1' }],
      ['end_match', { target_match_id: 'match-1' }],
      ['block_user', { target_user_id: 'user-2' }],
      ['unblock_user', { target_user_id: 'user-2' }],
      [
        'delete_match_chat',
        { target_match_id: 'match-1', delete_mode: 'block' },
      ],
    ]);
  });

  it('durum değiştiren RPC hatasında başarı raporlamaz', async () => {
    const error = new Error('permission denied');
    mockRpc.mockResolvedValue({ data: null, error });

    await expect(blockUser('user-2')).rejects.toBe(error);
  });

  it('liste ve sohbet aboneliklerini doğru filtrelerle kurup temizler', () => {
    const listChannel = createChannel();
    const directChannel = createChannel();
    mockChannel
      .mockReturnValueOnce(listChannel)
      .mockReturnValueOnce(directChannel);
    const onChange = jest.fn();

    const unsubscribeList = subscribeToMatchList('user-1', onChange);
    const unsubscribeDirect = subscribeToDirectMessages('match-1', onChange);
    unsubscribeList();
    unsubscribeDirect();

    expect(mockChannel.mock.calls).toEqual([
      ['message-list:user-1'],
      ['direct-messages:match-1'],
    ]);
    expect(listChannel.on).toHaveBeenCalledTimes(2);
    expect(directChannel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ filter: 'match_id=eq.match-1' }),
      onChange,
    );
    expect(mockRemoveChannel.mock.calls).toEqual([
      [listChannel],
      [directChannel],
    ]);
  });
});
