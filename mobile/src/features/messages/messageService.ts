import { paginationLimits } from '@shared/constants/limits';
import { applyAbortSignal } from '@shared/lib/network';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import type { Database } from '@shared/types/database';
import type { Candidate, DirectMessage, Match } from '@shared/types/domain';

type MatchListRow =
  Database['public']['Functions']['list_matches']['Returns'][number];
type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'];

function mapListMatch(
  row: MatchListRow,
  photoUrls: Map<string, string>,
): Match {
  const photoUrl = row.other_primary_photo_path
    ? photoUrls.get(row.other_primary_photo_path) ?? null
    : null;
  const otherUser: Candidate = {
    id: row.other_user_id,
    fullName: row.other_full_name,
    username: row.other_username,
    age: row.other_age,
    gender: row.other_gender,
    bio: row.other_bio,
    city: row.other_city,
    joinedAt: row.match_created_at,
    photos: photoUrl
      ? [
          {
            id: `${row.other_user_id}-primary`,
            userId: row.other_user_id,
            storagePath: row.other_primary_photo_path ?? '',
            position: 0,
            url: photoUrl,
          },
        ]
      : [],
    interests: [],
  };
  return {
    id: row.match_id,
    eventId: row.event_id,
    eventTitle: row.event_title,
    otherUser,
    status: row.match_status,
    createdAt: row.match_created_at,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    unreadCount: Number(row.unread_count),
  };
}

export async function listMatches(
  filter: 'all' | 'unread' | 'read' | 'ended' | 'blocked',
  cursor: { activityAt: string; matchId: string } | null = null,
  signal?: AbortSignal,
): Promise<{
  items: Match[];
  nextCursor: { activityAt: string; matchId: string } | null;
}> {
  const { data, error } = await applyAbortSignal(
    supabase.rpc('list_matches', {
      status_filter: filter,
      page_size: paginationLimits.conversations,
      cursor_activity_at: cursor?.activityAt ?? null,
      cursor_match_id: cursor?.matchId ?? null,
    }),
    signal,
  );
  if (error) throw error;
  const photoUrls = await getSignedProfilePhotoUrls(
    data.flatMap(row =>
      row.other_primary_photo_path ? [row.other_primary_photo_path] : [],
    ),
  );
  const last = data.at(-1);
  return {
    items: data.map(row => mapListMatch(row, photoUrls)),
    nextCursor:
      data.length === 30 && last
        ? { activityAt: last.activity_at, matchId: last.match_id }
        : null,
  };
}

export async function getMatch(
  matchId: string,
  signal?: AbortSignal,
): Promise<Match> {
  const { data, error } = await applyAbortSignal(
    supabase.rpc('get_chat_match_context', {
      target_match_id: matchId,
    }),
    signal,
  );
  if (error) throw error;
  const context = data[0];
  if (!context) throw new Error('Eşleşme bulunamadı.');
  const photoUrls = await getSignedProfilePhotoUrls(
    context.photo_storage_paths,
  );
  return {
    id: context.match_id,
    eventId: context.event_id,
    eventTitle: context.event_title,
    otherUser: {
      id: context.other_user_id,
      fullName: context.other_full_name ?? 'EtkinLink kullanıcısı',
      username: context.other_username ?? 'kullanici',
      age: context.other_age,
      gender: context.other_gender,
      bio: context.other_bio ?? '',
      city: context.other_city ?? '',
      joinedAt: context.match_created_at,
      photos: context.photo_storage_paths.flatMap((storagePath, index) => {
        const url = photoUrls.get(storagePath);
        const id = context.photo_ids[index];
        const position = context.photo_positions[index];
        if (!url || !id || position === undefined) return [];
        return [
          {
            id,
            userId: context.other_user_id,
            storagePath,
            position,
            url,
          },
        ];
      }),
      interests: [],
    },
    status: context.match_status,
    createdAt: context.match_created_at,
    lastMessage: context.last_message,
    lastMessageAt: context.last_message_at,
    unreadCount: 0,
    blockedByMe: context.blocked_by_me,
  };
}

function mapMessage(row: DirectMessageRow): DirectMessage {
  return {
    id: row.id,
    matchId: row.match_id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    body: row.body,
    clientMessageId: row.client_message_id,
    readAt: row.read_at,
    createdAt: row.created_at,
    status: row.read_at ? 'read' : 'sent',
  };
}

export async function listDirectMessages(
  matchId: string,
  cursor: { createdAt: string; id: string } | null = null,
  signal?: AbortSignal,
): Promise<{
  items: DirectMessage[];
  nextCursor: { createdAt: string; id: string } | null;
}> {
  let query = supabase
    .from('direct_messages')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(35);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  const { data, error } = await applyAbortSignal(query, signal);
  if (error) throw error;
  const last = data.at(-1);
  return {
    items: data.map(mapMessage),
    nextCursor:
      data.length === 35 && last
        ? { createdAt: last.created_at, id: last.id }
        : null,
  };
}

export async function sendDirectMessage(
  matchId: string,
  body: string,
  clientMessageId: string,
): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('send_direct_message', {
    target_match_id: matchId,
    message_body: body,
    client_message_id: clientMessageId,
  });
  if (error) throw error;
  return mapMessage(data);
}

export async function markMatchRead(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_match_read', {
    target_match_id: matchId,
  });
  if (error) throw error;
}

export async function endMatch(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('end_match', {
    target_match_id: matchId,
  });
  if (error) throw error;
}

export async function blockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', {
    target_user_id: userId,
  });
  if (error) throw error;
}

export async function unblockUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_user', {
    target_user_id: userId,
  });
  if (error) throw error;
}

export async function deleteMatchChat(
  matchId: string,
  mode: 'end' | 'block',
): Promise<void> {
  const { error } = await supabase.rpc('delete_match_chat', {
    target_match_id: matchId,
    delete_mode: mode,
  });
  if (error) throw error;
}

export function subscribeToMatchList(
  userId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`message-list:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'direct_messages' },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches' },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToDirectMessages(
  matchId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`direct-messages:${matchId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'direct_messages',
        filter: `match_id=eq.${matchId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
