import { supabase } from '@shared/lib/supabase';
import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { type AppPresencePayload, buildAppPresenceTopic } from './presence';
import {
  removeOrphanedRealtimeTopic,
  removeRealtimeChannel,
} from './realtimeChannel';

export function useAppPresence(userId: string | null): void {
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const joinedRef = useRef(false);
  const payloadRef = useRef<AppPresencePayload | null>(null);

  payloadRef.current = userId
    ? {
        userId,
        kind: 'app',
        isOnline: appState === 'active',
        updatedAt: new Date().toISOString(),
      }
    : null;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const topic = buildAppPresenceTopic(userId);

    void removeOrphanedRealtimeTopic(topic).then(() => {
      if (cancelled) return;
      channel = supabase.channel(topic, {
        config: {
          private: true,
          presence: { key: userId },
        },
      });
      channelRef.current = channel;
      channel.subscribe(status => {
        if (status !== 'SUBSCRIBED' || !payloadRef.current) return;
        joinedRef.current = true;
        void channel?.track(payloadRef.current);
      });
    });

    return () => {
      cancelled = true;
      joinedRef.current = false;
      channelRef.current = null;
      if (channel) {
        void channel.untrack().catch(() => undefined);
        void removeRealtimeChannel(channel);
      }
    };
  }, [userId]);

  useEffect(() => {
    if (!joinedRef.current || !channelRef.current || !payloadRef.current)
      return;
    void channelRef.current.track(payloadRef.current);
  }, [appState]);
}
