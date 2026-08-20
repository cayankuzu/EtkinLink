export const queryKeys = {
  events: {
    all: ['events'] as const,
    feed: <T>(filterKey: T) => ['events', filterKey] as const,
    detail: (eventId: string) => ['event', eventId] as const,
    preview: ['events-preview'] as const,
    previewFor: <T>(filterKey: T) => ['events-preview', filterKey] as const,
    snapshot: ['events-snapshot'] as const,
    snapshotFor: <T>(viewerId: string, filterKey: T) =>
      ['events-snapshot', viewerId, filterKey] as const,
    searchIndex: ['event-search-index'] as const,
    searchIndexFor: (scope: 'preview' | 'complete' | 'broad') =>
      ['event-search-index', scope] as const,
    saved: ['saved-events'] as const,
    categories: ['event-categories'] as const,
  },
  profile: {
    all: ['profile'] as const,
    current: ['profile', 'current'] as const,
    byId: (userId: string | undefined) => ['profile', userId] as const,
    events: (userId: string | undefined, status: 'upcoming' | 'attended') =>
      ['profile-events', userId, status] as const,
    currentUserId: ['current-user-id'] as const,
    accountEmail: ['account-email'] as const,
    settings: ['settings-profile'] as const,
    interests: ['interests'] as const,
    matchFilters: ['profile-match-filters'] as const,
    matchContext: (userId: string) => ['match-context', userId] as const,
    participationStatus: ['profile', 'participation-status'] as const,
    blockedUsers: ['blocked-users'] as const,
  },
  messages: {
    matches: ['matches'] as const,
    matchList: (filter: string) => ['matches', filter] as const,
    match: (matchId: string) => ['match', matchId] as const,
    direct: (matchId?: string) =>
      matchId
        ? (['direct-messages', matchId] as const)
        : (['direct-messages'] as const),
  },
  rooms: {
    all: ['rooms'] as const,
    messages: (eventId?: string) =>
      eventId
        ? (['room-messages', eventId] as const)
        : (['room-messages'] as const),
    participants: (eventId: string) => ['room-participants', eventId] as const,
  },
  matching: {
    candidates: (eventId?: string) =>
      eventId ? (['candidates', eventId] as const) : (['candidates'] as const),
    swipeQuota: ['swipe-quota'] as const,
    likeCounts: ['matching-like-counts'] as const,
    liked: ['liked-candidates'] as const,
    incomingLiked: ['incoming-liked-candidates'] as const,
    settings: (eventId?: string) =>
      eventId
        ? (['matching-settings', eventId] as const)
        : (['matching-settings'] as const),
    preferences: ['match-preferences'] as const,
  },
  auth: {
    registrationInterests: ['registration-interests'] as const,
  },
} as const;
