import { outboxLimits } from '@shared/constants/limits';

import { secureStorage } from './secureStorage';

const storageKey = 'chat-outbox-v1';

export type OutboxKind = 'room' | 'direct';

export type OutboxMessage = {
  kind: OutboxKind;
  contextId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
};

function isValidMessage(value: unknown): value is OutboxMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OutboxMessage>;
  return (
    (record.kind === 'room' || record.kind === 'direct') &&
    typeof record.contextId === 'string' &&
    typeof record.clientMessageId === 'string' &&
    typeof record.body === 'string' &&
    typeof record.createdAt === 'string'
  );
}

async function readAll(): Promise<OutboxMessage[]> {
  const raw = await secureStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const cutoff = Date.now() - outboxLimits.maxAgeMs;
    return Array.isArray(parsed)
      ? parsed
          .filter(isValidMessage)
          .filter(message => new Date(message.createdAt).getTime() >= cutoff)
          .slice(-outboxLimits.messages)
      : [];
  } catch {
    return [];
  }
}

async function writeAll(messages: OutboxMessage[]): Promise<void> {
  if (messages.length === 0) {
    await secureStorage.removeItem(storageKey);
    return;
  }
  await secureStorage.setItem(
    storageKey,
    JSON.stringify(messages.slice(-outboxLimits.messages)),
  );
}

export async function enqueueOutbox(message: OutboxMessage): Promise<void> {
  const current = await readAll();
  if (current.some(item => item.clientMessageId === message.clientMessageId))
    return;
  await writeAll([...current, message]);
}

export async function removeFromOutbox(clientMessageId: string): Promise<void> {
  const current = await readAll();
  await writeAll(
    current.filter(message => message.clientMessageId !== clientMessageId),
  );
}

export async function listOutbox(
  kind: OutboxKind,
  contextId: string,
): Promise<OutboxMessage[]> {
  const current = await readAll();
  return current.filter(
    message => message.kind === kind && message.contextId === contextId,
  );
}

export async function flushOutbox(
  kind: OutboxKind,
  contextId: string,
  sender: (message: OutboxMessage) => Promise<void>,
): Promise<void> {
  const pending = await listOutbox(kind, contextId);
  for (const message of pending) {
    try {
      await sender(message);
      await removeFromOutbox(message.clientMessageId);
    } catch {
      break;
    }
  }
}
