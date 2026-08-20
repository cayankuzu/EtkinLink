import { supabase } from '@shared/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';

type Options = {
  eventId: string;
  currentUserId: string | null;
  onMessage: () => void;
};

const typingIdleMs = 2_500;
const typingExpiryMs = 3_500;
const typingRefreshMs = 2_000;

export function useRoomRealtime({
  eventId,
  currentUserId,
  onMessage,
}: Options) {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingRef = useRef(false);
  const lastTypingBroadcastAt = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const broadcastTyping = useCallback(
    async (typing: boolean) => {
      typingRef.current = typing;
      lastTypingBroadcastAt.current = typing ? Date.now() : 0;
      const channel = channelRef.current;
      if (!channel || !currentUserId) return;
      await channel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: currentUserId, typing, at: Date.now() },
      });
    },
    [currentUserId],
  );

  const stopTyping = useCallback(() => {
    if (idleTimer.current) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    if (typingRef.current) void broadcastTyping(false);
  }, [broadcastTyping]);

  const notifyTyping = useCallback(
    (text: string) => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (!text.trim()) {
        stopTyping();
        return;
      }
      if (
        !typingRef.current ||
        Date.now() - lastTypingBroadcastAt.current >= typingRefreshMs
      ) {
        void broadcastTyping(true);
      }
      idleTimer.current = setTimeout(() => {
        void broadcastTyping(false);
        idleTimer.current = null;
      }, typingIdleMs);
    },
    [broadcastTyping, stopTyping],
  );

  useEffect(() => {
    if (!currentUserId) return;
    void supabase.realtime.setAuth();
    const channel = supabase.channel(`room:${eventId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    const activeExpiryTimers = expiryTimers.current;
    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'room_messages',
          filter: `event_id=eq.${eventId}`,
        },
        onMessage,
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const userId = typeof payload.userId === 'string' ? payload.userId : '';
        if (!userId || userId === currentUserId) return;
        const existingTimer = activeExpiryTimers.get(userId);
        if (existingTimer) clearTimeout(existingTimer);
        if (payload.typing !== true) {
          activeExpiryTimers.delete(userId);
          setTypingUserIds(current =>
            current.filter(candidateId => candidateId !== userId),
          );
          return;
        }
        setTypingUserIds(current =>
          current.includes(userId) ? current : [...current, userId],
        );
        activeExpiryTimers.set(
          userId,
          setTimeout(() => {
            activeExpiryTimers.delete(userId);
            setTypingUserIds(current =>
              current.filter(candidateId => candidateId !== userId),
            );
          }, typingExpiryMs),
        );
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      for (const timer of activeExpiryTimers.values()) clearTimeout(timer);
      activeExpiryTimers.clear();
      if (typingRef.current)
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: currentUserId, typing: false, at: Date.now() },
        });
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [currentUserId, eventId, onMessage]);

  return { typingUserIds, notifyTyping, stopTyping };
}
