import { paginationLimits } from '@shared/constants/limits';
import { premiumFeaturesAvailable } from '@shared/constants/premium';
import { createClientId } from '@shared/lib/ids';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import type {
  Candidate,
  CompatibilitySnapshot,
  Interest,
  MatchContext,
  ProfileGender,
  ProfilePhoto,
} from '@shared/types/domain';

import { parseCompatibility, parseMatchContext } from './compatibility';

type CandidateRow = {
  id: string;
  full_name: string;
  username: string;
  age: number | null;
  gender: ProfileGender | null;
  bio: string;
  city: string;
  joined_at: string;
  incoming_like: boolean;
};

export type CandidateCursor = {
  incomingLike: boolean;
  joinedAt: string;
  userId: string;
};

export type SwipeQuota = {
  windowStartedAt: string;
  resetAt: string;
  serverNow: string;
  likeLimit: number;
  passLimit: number;
  usedLikes: number;
  usedPasses: number;
  remainingLikes: number;
  remainingPasses: number;
};

export type LikedCandidate = {
  candidate: Candidate;
  eventId: string;
  eventTitle: string;
  likedAt: string;
  matched: boolean;
};

type LikedCandidateRow = CandidateRow & {
  event_id: string;
  event_title: string;
  liked_at: string;
  is_matched: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseSwipeQuota(value: unknown): SwipeQuota {
  if (!isRecord(value)) throw new Error('Eşleşme hakları okunamadı.');
  return {
    windowStartedAt:
      typeof value.windowStartedAt === 'string'
        ? value.windowStartedAt
        : new Date().toISOString(),
    resetAt:
      typeof value.resetAt === 'string'
        ? value.resetAt
        : new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
    serverNow:
      typeof value.serverNow === 'string'
        ? value.serverNow
        : new Date().toISOString(),
    likeLimit: numeric(value.likeLimit),
    passLimit: numeric(value.passLimit),
    usedLikes: numeric(value.usedLikes),
    usedPasses: numeric(value.usedPasses),
    remainingLikes: numeric(value.remainingLikes),
    remainingPasses: numeric(value.remainingPasses),
  };
}

async function enrichCandidates(rows: CandidateRow[]): Promise<Candidate[]> {
  const ids = rows.map(row => row.id);
  if (ids.length === 0) return [];
  const [
    { data: photoRows, error: photoError },
    { data: interestRows, error: userInterestError },
    { data: compatibilityRows, error: compatibilityError },
  ] = await Promise.all([
    supabase
      .from('profile_photos')
      .select('*')
      .in('user_id', ids)
      .order('position'),
    supabase.from('user_interests').select('*').in('user_id', ids),
    supabase.rpc('get_candidate_compatibilities', {
      target_user_ids: ids,
    }),
  ]);
  if (photoError) throw photoError;
  if (userInterestError) throw userInterestError;
  if (compatibilityError) throw compatibilityError;
  const signedUrls = await getSignedProfilePhotoUrls(
    photoRows.map(photo => photo.storage_path),
  );
  const interestIds = Array.from(
    new Set(interestRows.map(row => row.interest_id)),
  );
  const { data: interests, error: interestError } =
    interestIds.length > 0
      ? await supabase
          .from('interests')
          .select('id,slug,label,sort_order')
          .in('id', interestIds)
      : { data: [], error: null };
  if (interestError) throw interestError;
  const interestMap = new Map(
    interests.map(item => [
      item.id,
      {
        id: item.id,
        slug: item.slug,
        label: item.label,
        sortOrder: item.sort_order,
      } satisfies Interest,
    ]),
  );
  const photosByUser = new Map<string, ProfilePhoto[]>();
  for (const photo of photoRows) {
    const url = signedUrls.get(photo.storage_path);
    if (!url) continue;
    const item: ProfilePhoto = {
      id: photo.id,
      userId: photo.user_id,
      storagePath: photo.storage_path,
      position: photo.position,
      url,
    };
    photosByUser.set(photo.user_id, [
      ...(photosByUser.get(photo.user_id) ?? []),
      item,
    ]);
  }
  const interestsByUser = new Map<string, Interest[]>();
  for (const row of interestRows) {
    const interest = interestMap.get(row.interest_id);
    if (interest)
      interestsByUser.set(row.user_id, [
        ...(interestsByUser.get(row.user_id) ?? []),
        interest,
      ]);
  }
  const compatibilityByUser = new Map<string, CompatibilitySnapshot>(
    compatibilityRows.map(row => [
      row.target_user_id,
      parseCompatibility(row.compatibility),
    ]),
  );
  return rows.map(row => ({
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    age: row.age,
    gender: row.gender,
    bio: row.bio,
    city: row.city,
    joinedAt: row.joined_at,
    photos: photosByUser.get(row.id) ?? [],
    interests: interestsByUser.get(row.id) ?? [],
    compatibility: compatibilityByUser.get(row.id),
  }));
}

export async function getMatchContext(
  userId?: string,
  matchId?: string,
): Promise<MatchContext | null> {
  const { data, error } = await supabase.rpc('get_match_context', {
    target_user_id: userId ?? null,
    target_match_id: matchId ?? null,
  });
  if (error) throw error;
  return parseMatchContext(data);
}

export async function listCandidates(
  eventId: string,
  cursor: CandidateCursor | null = null,
): Promise<{
  items: Candidate[];
  nextCursor: CandidateCursor | null;
}> {
  const { data, error } = await supabase.rpc('get_event_candidates', {
    target_event_id: eventId,
    page_size: paginationLimits.candidates,
    after_incoming: cursor?.incomingLike ?? null,
    after_joined_at: cursor?.joinedAt ?? null,
    after_user_id: cursor?.userId ?? null,
  });
  if (error) throw error;
  const items = await enrichCandidates(data);
  const last = data.at(-1);
  return {
    items,
    nextCursor:
      data.length === paginationLimits.candidates && last
        ? {
            incomingLike: last.incoming_like,
            joinedAt: last.joined_at,
            userId: last.id,
          }
        : null,
  };
}

export function subscribeToCandidateChanges(
  eventId: string,
  onChange: () => void,
): () => void {
  const channel = supabase
    .channel(`matching-candidates:${eventId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_attendees',
        filter: `event_id=eq.${eventId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

export async function swipeCandidate(
  eventId: string,
  userId: string,
  action: 'like' | 'pass',
): Promise<{
  matched: boolean;
  matchId: string | null;
  quota: SwipeQuota;
}> {
  const { data, error } = await supabase.rpc('swipe_event_candidate_v2', {
    target_event_id: eventId,
    target_user_id: userId,
    action,
    request_id: createClientId(),
  });
  if (error) throw error;
  const result = isRecord(data) ? data : {};
  return {
    matched: result.matched === true,
    matchId: typeof result.match_id === 'string' ? result.match_id : null,
    quota: parseSwipeQuota(result.quota),
  };
}

export async function getSwipeQuota(): Promise<SwipeQuota> {
  const { data, error } = await supabase.rpc('get_swipe_quota', {});
  if (error) throw error;
  return parseSwipeQuota(data);
}

export async function getMatchingLikeCounts(): Promise<{
  outgoingCount: number;
  incomingCount: number;
  incomingLocked: boolean;
}> {
  const { data, error } = await supabase.rpc('get_matching_like_counts', {});
  if (error) throw error;
  const result = isRecord(data) ? data : {};
  return {
    outgoingCount: numeric(result.outgoingCount),
    incomingCount: numeric(result.incomingCount),
    incomingLocked: result.incomingLocked !== false,
  };
}

async function listLikeCandidates(
  rpcName: 'get_outgoing_event_likes' | 'get_incoming_event_likes',
  cursor: { likedAt: string; userId: string } | null = null,
): Promise<{
  items: LikedCandidate[];
  nextCursor: { likedAt: string; userId: string } | null;
}> {
  const { data, error } = await supabase.rpc(rpcName, {
    page_size: paginationLimits.candidates,
    after_liked_at: cursor?.likedAt ?? null,
    after_user_id: cursor?.userId ?? null,
  });
  if (error) throw error;
  const rows = data as LikedCandidateRow[];
  const candidates = await enrichCandidates(rows);
  const candidateMap = new Map(
    candidates.map(candidate => [candidate.id, candidate]),
  );
  const items = rows.flatMap(row => {
    const candidate = candidateMap.get(row.id);
    return candidate
      ? [
          {
            candidate,
            eventId: row.event_id,
            eventTitle: row.event_title,
            likedAt: row.liked_at,
            matched: row.is_matched,
          },
        ]
      : [];
  });
  const last = rows.at(-1);
  return {
    items,
    nextCursor:
      rows.length === paginationLimits.candidates && last
        ? { likedAt: last.liked_at, userId: last.id }
        : null,
  };
}

export async function listLikedCandidates(
  cursor: { likedAt: string; userId: string } | null = null,
) {
  return listLikeCandidates('get_outgoing_event_likes', cursor);
}

export async function listIncomingLikedCandidates(
  cursor: { likedAt: string; userId: string } | null = null,
) {
  return listLikeCandidates('get_incoming_event_likes', cursor);
}

export async function changeLikeToPass(
  eventId: string,
  userId: string,
): Promise<SwipeQuota> {
  const { data, error } = await supabase.rpc('change_event_like_to_pass', {
    target_event_id: eventId,
    target_user_id: userId,
    request_id: createClientId(),
  });
  if (error) throw error;
  const result = isRecord(data) ? data : {};
  return parseSwipeQuota(result.quota);
}

export async function getMatchingSettings(eventId: string): Promise<{
  globalEnabled: boolean;
  eventEnabled: boolean;
  premium: boolean;
  profileReady: boolean;
  photoCount: number;
  hasBio: boolean;
  interestCount: number;
}> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData.user.id;
  const [
    { data: profiles, error: profileError },
    { data: attendee, error: attendeeError },
    { count: photoCount, error: photoError },
    { count: interestCount, error: interestError },
  ] = await Promise.all([
    supabase.rpc('get_my_profile'),
    supabase
      .from('event_attendees')
      .select('matching_enabled')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .single(),
    supabase
      .from('profile_photos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('user_interests')
      .select('interest_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);
  if (profileError) throw profileError;
  if (attendeeError) throw attendeeError;
  if (photoError) throw photoError;
  if (interestError) throw interestError;
  const profile = profiles.find(item => item.id === userId);
  if (!profile) throw new Error('Profil bulunamadı.');
  const safePhotoCount = photoCount ?? 0;
  const safeInterestCount = interestCount ?? 0;
  const hasBio = (profile.bio?.trim().length ?? 0) >= 20;
  return {
    globalEnabled: profile.matching_enabled,
    eventEnabled: attendee.matching_enabled,
    premium: premiumFeaturesAvailable,
    profileReady: safePhotoCount >= 3 && hasBio && safeInterestCount >= 3,
    photoCount: safePhotoCount,
    hasBio,
    interestCount: safeInterestCount,
  };
}

export async function setMatchingEnabled(
  enabled: boolean,
  eventId: string | null = null,
): Promise<void> {
  const { error } = await supabase.rpc('set_matching_enabled', {
    enabled,
    target_event_id: eventId,
  });
  if (error) throw error;
}
