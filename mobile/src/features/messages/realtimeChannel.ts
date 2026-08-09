import { supabase } from '@shared/lib/supabase';

type Channel = ReturnType<typeof supabase.channel>;

export async function removeRealtimeChannel(channel: Channel): Promise<void> {
  const status = await supabase
    .removeChannel(channel)
    .catch(() => 'error' as const);
  if (status !== 'ok') channel.teardown();
}

export async function removeOrphanedRealtimeTopic(
  topic: string,
): Promise<void> {
  const realtimeTopic = `realtime:${topic}`;
  const orphanedChannels = supabase
    .getChannels()
    .filter(channel => channel.topic === realtimeTopic);
  await Promise.all(orphanedChannels.map(removeRealtimeChannel));
}
