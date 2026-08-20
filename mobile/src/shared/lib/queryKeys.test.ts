import { queryKeys } from './queryKeys';

describe('ortak query key fabrikaları', () => {
  it('domain köklerini ve parametreli anahtarları kararlı üretir', () => {
    const filters = { city: 'İstanbul' };
    expect(queryKeys.events.feed(filters)).toEqual(['events', filters]);
    expect(queryKeys.events.detail('event')).toEqual(['event', 'event']);
    expect(queryKeys.events.previewFor(filters)).toEqual([
      'events-preview',
      filters,
    ]);
    expect(queryKeys.events.snapshotFor('user', filters)).toEqual([
      'events-snapshot',
      'user',
      filters,
    ]);
    expect(queryKeys.events.searchIndexFor('complete')).toEqual([
      'event-search-index',
      'complete',
    ]);
    expect(queryKeys.profile.byId('user')).toEqual(['profile', 'user']);
    expect(queryKeys.profile.events('user', 'attended')).toEqual([
      'profile-events',
      'user',
      'attended',
    ]);
    expect(queryKeys.profile.matchContext('user')).toEqual([
      'match-context',
      'user',
    ]);
    expect(queryKeys.messages.matchList('all')).toEqual(['matches', 'all']);
    expect(queryKeys.messages.match('match')).toEqual(['match', 'match']);
    expect(queryKeys.messages.direct('match')).toEqual([
      'direct-messages',
      'match',
    ]);
    expect(queryKeys.messages.direct()).toEqual(['direct-messages']);
    expect(queryKeys.rooms.messages('event')).toEqual([
      'room-messages',
      'event',
    ]);
    expect(queryKeys.rooms.messages()).toEqual(['room-messages']);
    expect(queryKeys.rooms.participants('event')).toEqual([
      'room-participants',
      'event',
    ]);
    expect(queryKeys.matching.candidates('event')).toEqual([
      'candidates',
      'event',
    ]);
    expect(queryKeys.matching.candidates()).toEqual(['candidates']);
    expect(queryKeys.matching.settings('event')).toEqual([
      'matching-settings',
      'event',
    ]);
    expect(queryKeys.matching.settings()).toEqual(['matching-settings']);
  });
});
