import { paginationLimits } from '@shared/constants/limits';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';

export type RoomParticipant = {
  id: string;
  fullName: string;
  username: string;
  bio: string;
  city: string;
  photoUrl: string | null;
  joinedAt: string;
};

export async function listRoomParticipants(
  eventId: string,
): Promise<RoomParticipant[]> {
  const { data: attendees, error: attendeeError } = await supabase
    .from('event_attendees')
    .select('user_id,joined_at')
    .eq('event_id', eventId)
    .eq('status', 'joined')
    .order('joined_at', { ascending: true })
    .limit(paginationLimits.roomParticipants);
  if (attendeeError) throw attendeeError;
  const userIds = attendees.map(item => item.user_id);
  if (userIds.length === 0) return [];
  const [
    { data: profiles, error: profileError },
    { data: photos, error: photoError },
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id,full_name,username,bio,city')
      .in('id', userIds),
    supabase
      .from('profile_photos')
      .select('user_id,storage_path,position')
      .in('user_id', userIds)
      .eq('position', 0),
  ]);
  if (profileError) throw profileError;
  if (photoError) throw photoError;
  const signedUrls = await getSignedProfilePhotoUrls(
    photos.map(photo => photo.storage_path),
  );
  const photoByUser = new Map(
    photos.map(photo => [
      photo.user_id,
      signedUrls.get(photo.storage_path) ?? null,
    ]),
  );
  const joinedAtByUser = new Map(
    attendees.map(item => [item.user_id, item.joined_at]),
  );
  return profiles
    .map(profile => ({
      id: profile.id,
      fullName: profile.full_name ?? 'EtkinLink kullanıcısı',
      username: profile.username ?? 'kullanici',
      bio: profile.bio ?? '',
      city: profile.city ?? '',
      photoUrl: photoByUser.get(profile.id) ?? null,
      joinedAt: joinedAtByUser.get(profile.id) ?? '',
    }))
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
}
