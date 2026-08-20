import { sendDirectMessage } from '@features/messages/messageService';
import { sendRoomMessage } from '@features/rooms/roomService';
import NetInfo from '@react-native-community/netinfo';
import { flushAllOutbox, type OutboxMessage } from '@shared/lib/chatOutbox';
import { captureAppError } from '@shared/lib/telemetry';
import { useEffect } from 'react';
import { AppState } from 'react-native';

type Props = { userId: string };
let lastReportedFlushErrorAt = 0;

async function deliver(message: OutboxMessage): Promise<void> {
  if (message.kind === 'direct') {
    await sendDirectMessage(
      message.contextId,
      message.body,
      message.clientMessageId,
    );
    return;
  }
  await sendRoomMessage(
    message.contextId,
    message.body,
    message.clientMessageId,
  );
}

export function OutboxSyncController({ userId }: Props) {
  useEffect(() => {
    const flush = () => {
      void flushAllOutbox(userId, deliver).catch(error => {
        if (Date.now() - lastReportedFlushErrorAt < 60_000) return;
        lastReportedFlushErrorAt = Date.now();
        captureAppError(error, { operation: 'outbox.flush' });
      });
    };
    flush();
    const unsubscribeNetwork = NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable !== false) flush();
    });
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') flush();
    });
    return () => {
      unsubscribeNetwork();
      appStateSubscription.remove();
    };
  }, [userId]);

  return null;
}
