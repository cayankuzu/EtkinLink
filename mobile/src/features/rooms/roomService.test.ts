import { addDays, subDays } from 'date-fns';

import { getRoomState } from './roomRules';

describe('etkinlik odası zaman penceresi', () => {
  const start = new Date('2026-09-20T18:00:00.000Z');
  const end = new Date('2026-09-20T21:00:00.000Z');

  it('13 günden daha önce kilitlidir', () => {
    expect(
      getRoomState(start.toISOString(), end.toISOString(), subDays(start, 14)),
    ).toBe('locked');
  });

  it('tam 13 gün önce açılır', () => {
    expect(
      getRoomState(start.toISOString(), end.toISOString(), subDays(start, 13)),
    ).toBe('active');
  });

  it('etkinlik bitimine kadar aktiftir', () => {
    expect(getRoomState(start.toISOString(), end.toISOString(), end)).toBe(
      'active',
    );
  });

  it('bitişten sonra üç gün yazılabilir', () => {
    expect(
      getRoomState(start.toISOString(), end.toISOString(), addDays(end, 3)),
    ).toBe('postEvent');
  });

  it('üç günlük pencere sonrasında arşivlenir', () => {
    expect(
      getRoomState(
        start.toISOString(),
        end.toISOString(),
        new Date(addDays(end, 3).getTime() + 1),
      ),
    ).toBe('archived');
  });

  it('bitiş tarihi yoksa başlangıç tarihini bitiş olarak kullanır', () => {
    expect(getRoomState(start.toISOString(), null, start)).toBe('active');
    expect(getRoomState(start.toISOString(), null, addDays(start, 1))).toBe(
      'postEvent',
    );
  });
});
