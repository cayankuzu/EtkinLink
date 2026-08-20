import { useAppPresence } from '@features/messages/useAppPresence';
import { usePushRegistration } from '@shared/lib/pushNotifications';
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

import { AppDataWarmup } from './AppDataWarmup';
import { OutboxSyncController } from './OutboxSyncController';

type Props = { userId: string | null };

function PresenceService({ userId }: { userId: string | null }) {
  useAppPresence(userId);
  return null;
}

function PushService({ userId }: { userId: string | null }) {
  usePushRegistration(userId);
  return null;
}

export function DeferredAppServices({ userId }: Props) {
  const [presenceReady, setPresenceReady] = useState(false);
  const [outboxReady, setOutboxReady] = useState(false);
  const [pushReady, setPushReady] = useState(false);

  useEffect(() => {
    setPresenceReady(false);
    setOutboxReady(false);
    setPushReady(false);
    if (!userId) return undefined;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const interaction = InteractionManager.runAfterInteractions(() => {
      timers.push(
        setTimeout(() => setOutboxReady(true), 80),
        setTimeout(() => setPresenceReady(true), 160),
        setTimeout(() => setPushReady(true), 480),
      );
    });
    return () => {
      interaction.cancel();
      timers.forEach(clearTimeout);
    };
  }, [userId]);

  return (
    <>
      <AppDataWarmup enabled={Boolean(userId)} />
      {outboxReady && userId ? <OutboxSyncController userId={userId} /> : null}
      {presenceReady ? <PresenceService userId={userId} /> : null}
      {pushReady ? <PushService userId={userId} /> : null}
    </>
  );
}
