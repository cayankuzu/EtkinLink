import { supabase } from '@shared/lib/supabase';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AppPresencePayload,
  buildAppPresenceTopic,
  buildConversationPairKey,
  buildConversationTopic,
  hasOnlineAppPresence,
  type TypingBroadcastPayload,
} from './presence';
import {
  removeOrphanedRealtimeTopic,
  removeRealtimeChannel,
} from './realtimeChannel';

type Options = {
  currentUserId: string | null;
  otherUserId: string | null;
  enabled?: boolean;
  publishTyping?: boolean;
};

type ConversationRealtimeController = {
  typingChannel: ReturnType<typeof supabase.channel>;
  presenceChannel: ReturnType<typeof supabase.channel>;
  currentUserId: string;
  joined: boolean;
  consumers: number;
  presenceListeners: Set<() => void>;
  typingListeners: Set<(payload: TypingBroadcastPayload) => void>;
  disposalTimer: ReturnType<typeof setTimeout> | null;
};

// One controller is shared by list and detail consumers for the same pair.
const controllers = new Map<string, ConversationRealtimeController>();
const removalFlights = new Map<string, Promise<void>>();
const TYPING_EVENT = 'typing';
const TYPING_HEARTBEAT_MS = 2_000;
const TYPING_STALE_MS = 3_200;
const TYPING_IDLE_MS = 2_500;
const CHANNEL_IDLE_MS = 1_500;

function createController(
  pairKey: string,
  currentUserId: string,
  otherUserId: string,
): ConversationRealtimeController {
  const typingChannel = supabase.channel(buildConversationTopic(pairKey), {
    config: {
      private: true,
      broadcast: { self: true, ack: false },
    },
  });
  const presenceChannel = supabase.channel(buildAppPresenceTopic(otherUserId), {
    config: { private: true },
  });
  const controller: ConversationRealtimeController = {
    typingChannel,
    presenceChannel,
    currentUserId,
    joined: false,
    consumers: 0,
    presenceListeners: new Set(),
    typingListeners: new Set(),
    disposalTimer: null,
  };
  const notifyPresence = () => {
    controller.presenceListeners.forEach(listener => listener());
  };

  presenceChannel
    .on('presence', { event: 'sync' }, notifyPresence)
    .on('presence', { event: 'join' }, notifyPresence)
    .on('presence', { event: 'leave' }, notifyPresence);
  typingChannel.on('broadcast', { event: TYPING_EVENT }, ({ payload }) => {
    const typingPayload = payload as TypingBroadcastPayload;
    controller.typingListeners.forEach(listener => listener(typingPayload));
  });
  typingChannel.subscribe(status => {
    controller.joined = status === 'SUBSCRIBED';
  });
  presenceChannel.subscribe();
  controllers.set(pairKey, controller);
  return controller;
}

async function removeController(
  pairKey: string,
  controller: ConversationRealtimeController,
): Promise<void> {
  if (controllers.get(pairKey) === controller) controllers.delete(pairKey);
  controller.joined = false;
  await Promise.all([
    removeRealtimeChannel(controller.typingChannel),
    removeRealtimeChannel(controller.presenceChannel),
  ]);
}

function beginControllerRemoval(
  pairKey: string,
  controller: ConversationRealtimeController,
): Promise<void> {
  const activeRemoval = removalFlights.get(pairKey);
  if (activeRemoval) return activeRemoval;
  const removal = removeController(pairKey, controller).catch(() => undefined);
  removalFlights.set(pairKey, removal);
  void removal.finally(() => {
    if (removalFlights.get(pairKey) === removal) removalFlights.delete(pairKey);
  });
  return removal;
}

async function acquireController(
  pairKey: string,
  currentUserId: string,
  otherUserId: string,
): Promise<ConversationRealtimeController> {
  const removal = removalFlights.get(pairKey);
  if (removal) await removal;

  let controller = controllers.get(pairKey);
  if (controller && controller.currentUserId !== currentUserId) {
    await beginControllerRemoval(pairKey, controller);
    controller = undefined;
  }
  if (!controller) {
    await Promise.all([
      removeOrphanedRealtimeTopic(buildConversationTopic(pairKey)),
      removeOrphanedRealtimeTopic(buildAppPresenceTopic(otherUserId)),
    ]);
    controller = controllers.get(pairKey);
    controller ??= createController(pairKey, currentUserId, otherUserId);
  }
  if (controller.disposalTimer) {
    clearTimeout(controller.disposalTimer);
    controller.disposalTimer = null;
  }
  controller.consumers += 1;
  return controller;
}

function releaseController(
  pairKey: string,
  controller: ConversationRealtimeController,
): void {
  controller.consumers = Math.max(0, controller.consumers - 1);
  if (controller.consumers > 0 || controller.disposalTimer) return;
  controller.disposalTimer = setTimeout(() => {
    controller.disposalTimer = null;
    if (controller.consumers === 0)
      void beginControllerRemoval(pairKey, controller);
  }, CHANNEL_IDLE_MS);
}

async function sendTyping(
  controller: ConversationRealtimeController | null,
  userId: string,
  isTyping: boolean,
): Promise<void> {
  if (!controller?.joined) return;
  await controller.typingChannel.send({
    type: 'broadcast',
    event: TYPING_EVENT,
    payload: {
      userId,
      isTyping,
      updatedAt: new Date().toISOString(),
    } satisfies TypingBroadcastPayload,
  });
}

export function useConversationPresence({
  currentUserId,
  otherUserId,
  enabled = true,
  publishTyping = true,
}: Options) {
  const [otherOnline, setOtherOnline] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const controllerRef = useRef<ConversationRealtimeController | null>(null);
  const typingRef = useRef(false);
  const typingIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStaleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  typingRef.current = isTyping;
  const pairKey = useMemo(
    () =>
      currentUserId && otherUserId
        ? buildConversationPairKey(currentUserId, otherUserId)
        : null,
    [currentUserId, otherUserId],
  );

  const setTyping = useCallback(
    (nextTyping: boolean) => {
      if (!publishTyping) return;
      if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
      typingIdleTimer.current = null;
      setIsTyping(nextTyping);
      if (nextTyping)
        typingIdleTimer.current = setTimeout(() => {
          setIsTyping(false);
          typingIdleTimer.current = null;
        }, TYPING_IDLE_MS);
    },
    [publishTyping],
  );

  useEffect(() => {
    if (!enabled || !currentUserId || !otherUserId || !pairKey) {
      setOtherOnline(false);
      setOtherTyping(false);
      return;
    }

    let cancelled = false;
    let controller: ConversationRealtimeController | null = null;
    const syncPresence = () => {
      if (!controller) return;
      const state =
        controller.presenceChannel.presenceState<AppPresencePayload>();
      setOtherOnline(hasOnlineAppPresence(state, otherUserId));
    };
    const handleTyping = (payload: TypingBroadcastPayload) => {
      if (payload.userId !== otherUserId) return;
      if (typingStaleTimer.current) clearTimeout(typingStaleTimer.current);
      typingStaleTimer.current = null;
      setOtherTyping(payload.isTyping === true);
      if (payload.isTyping)
        typingStaleTimer.current = setTimeout(() => {
          setOtherTyping(false);
          typingStaleTimer.current = null;
        }, TYPING_STALE_MS);
    };

    void acquireController(pairKey, currentUserId, otherUserId).then(next => {
      if (cancelled) {
        releaseController(pairKey, next);
        return;
      }
      controller = next;
      controllerRef.current = next;
      next.presenceListeners.add(syncPresence);
      next.typingListeners.add(handleTyping);
      syncPresence();
      if (publishTyping && typingRef.current)
        void sendTyping(next, currentUserId, true);
    });

    return () => {
      cancelled = true;
      if (controller) {
        if (publishTyping) void sendTyping(controller, currentUserId, false);
        controller.presenceListeners.delete(syncPresence);
        controller.typingListeners.delete(handleTyping);
        releaseController(pairKey, controller);
      }
      if (controllerRef.current === controller) controllerRef.current = null;
      if (typingStaleTimer.current) clearTimeout(typingStaleTimer.current);
      typingStaleTimer.current = null;
    };
  }, [currentUserId, enabled, otherUserId, pairKey, publishTyping]);

  useEffect(() => {
    if (!enabled || !publishTyping || !currentUserId) return;
    void sendTyping(controllerRef.current, currentUserId, isTyping);
    const heartbeat = isTyping
      ? setInterval(
          () => void sendTyping(controllerRef.current, currentUserId, true),
          TYPING_HEARTBEAT_MS,
        )
      : null;
    return () => {
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [currentUserId, enabled, isTyping, publishTyping]);

  useEffect(
    () => () => {
      if (typingIdleTimer.current) clearTimeout(typingIdleTimer.current);
    },
    [],
  );

  return { otherOnline, otherTyping, setTyping };
}
