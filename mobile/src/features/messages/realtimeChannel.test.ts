jest.mock('@shared/lib/supabase', () => ({
  supabase: {
    getChannels: jest.fn(),
    removeChannel: jest.fn(),
  },
}));

import { supabase } from '@shared/lib/supabase';

import {
  removeOrphanedRealtimeTopic,
  removeRealtimeChannel,
} from './realtimeChannel';

const mockGetChannels = supabase.getChannels as jest.Mock;
const mockRemoveChannel = supabase.removeChannel as jest.Mock;

function channel(topic: string) {
  return { topic, teardown: jest.fn() };
}

describe('realtimeChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sunucu kanalı normal kapattığında zorunlu teardown yapmaz', async () => {
    const target = channel('realtime:conversation:a:b');
    mockRemoveChannel.mockResolvedValue('ok');

    await removeRealtimeChannel(target as never);

    expect(mockRemoveChannel).toHaveBeenCalledWith(target);
    expect(target.teardown).not.toHaveBeenCalled();
  });

  it('kapatma hata veya başarısız durum dönüyorsa yerel kanalı kesin temizler', async () => {
    const rejected = channel('realtime:conversation:a:b');
    const timedOut = channel('realtime:conversation:c:d');
    mockRemoveChannel
      .mockRejectedValueOnce(new Error('socket gone'))
      .mockResolvedValueOnce('timed out');

    await removeRealtimeChannel(rejected as never);
    await removeRealtimeChannel(timedOut as never);

    expect(rejected.teardown).toHaveBeenCalledTimes(1);
    expect(timedOut.teardown).toHaveBeenCalledTimes(1);
  });

  it('yalnızca tam topic eşleşen yetim kanalları kaldırır', async () => {
    const first = channel('realtime:conversation:a:b');
    const second = channel('realtime:conversation:a:b');
    const unrelated = channel('realtime:conversation:a:b:other');
    mockGetChannels.mockReturnValue([first, unrelated, second]);
    mockRemoveChannel.mockResolvedValue('ok');

    await removeOrphanedRealtimeTopic('conversation:a:b');

    expect(mockRemoveChannel.mock.calls).toEqual([[first], [second]]);
    expect(unrelated.teardown).not.toHaveBeenCalled();
  });
});
