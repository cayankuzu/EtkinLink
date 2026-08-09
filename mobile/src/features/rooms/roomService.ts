import { paginationLimits } from '@shared/constants/limits';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database';
import type { RoomMessage } from '@shared/types/domain';

import { getRoomState } from './roomRules';
import type { RoomCursor, RoomPage, RoomSummary } from './roomTypes';

type RoomRow =
  Database['public']['Functions']['list_joined_rooms']['Returns'][number];
type RoomMessageRow = Database['public']['Tables']['room_messages']['Row'];
type RoomMessageReadRow =
  Database['public']['Functions']['list_room_messages']['Returns'][number];

function mapRoom(row: RoomRow): RoomSummary {
  return {
    eventId: row.event_id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    imageUrl: row.image_url,
    city: row.city,
    venue: row.venue,
    joinedAt: row.joined_at,
    matchingEnabled: row.matching_enabled,
    roomOpen: row.room_open,
    unreadCount: Number(row.unread_count),
    lastMessage: row.last_message,
    lastMessageIsMine: row.last_message_is_mine,
    lastMessageSenderName: row.last_message_sender_name,
    lastMessageAt: row.last_message_at,
    state: getRoomState(row.start_at, row.end_at),
  };
}

export async function listRooms(
  cursor: RoomCursor | null = null,
): Promise<RoomPage> {
  const { data, error } = await supabase.rpc('list_joined_rooms', {
    page_size: paginationLimits.rooms,
    cursor_joined_at: cursor?.joinedAt ?? null,
    cursor_event_id: cursor?.eventId ?? null,
  });
  if (error) throw error;
  const items = data.map(mapRoom);
  const last = data.at(-1);
  return {
    items,
    nextCursor:
      data.length === 30 && last
        ? { joinedAt: last.joined_at, eventId: last.event_id }
        : null,
  };
}

async function mapMessages(rows: RoomMessageReadRow[]): Promise<RoomMessage[]> {
  const signedUrls = await getSignedProfilePhotoUrls(
    rows.flatMap(row => (row.sender_photo_path ? [row.sender_photo_path] : [])),
  );
  return rows.map(row => ({
    id: row.id,
    eventId: row.event_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderPhotoUrl: row.sender_photo_path
      ? signedUrls.get(row.sender_photo_path) ?? null
      : null,
    body: row.body,
    clientMessageId: row.client_message_id,
    createdAt: row.created_at,
    status: 'sent',
  }));
}

export async function listRoomMessages(
  eventId: string,
  cursor: { createdAt: string; id: string } | null = null,
): Promise<{
  items: RoomMessage[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const { data, error } = await supabase.rpc('list_room_messages', {
    target_event_id: eventId,
    page_size: 35,
    cursor_created_at: cursor?.createdAt ?? null,
    cursor_message_id: cursor?.id ?? null,
  });
  if (error) throw error;
  const items = await mapMessages(data);
  const last = data.at(-1);
  return {
    items,
    nextCursor:
      data.length === 35 && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  };
}

export async function sendRoomMessage(
  eventId: string,
  body: string,
  clientMessageId: string,
): Promise<RoomMessageRow> {
  const { data, error } = await supabase.rpc('send_room_message', {
    target_event_id: eventId,
    message_body: body,
    client_message_id: clientMessageId,
  });
  if (error) throw error;
  return data;
}

export async function markRoomRead(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_room_read', {
    target_event_id: eventId,
  });
  if (error) throw error;
}

export function subscribeToRoomListChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel('joined-rooms-list')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'room_messages' },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_read_states' },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function submitRoomReport(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('submit_room_report', {
    target_event_id: eventId,
    reason: 'other',
    details: 'Kullanıcı oda seçeneklerinden bu etkinlik odasını bildirdi.',
  });
  if (error) throw error;
}
