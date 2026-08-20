import { outboxLimits } from '@shared/constants/limits';

import { secureStorage } from './secureStorage';

const storageKey = 'chat-outbox-v1';
const backupStorageKey = 'chat-outbox-v1-backup';
let storageQueue: Promise<void> = Promise.resolve();

export type OutboxKind = 'room' | 'direct';

export type OutboxMessage = {
  ownerId: string;
  kind: OutboxKind;
  contextId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  attempt: number;
  nextAttemptAt: string;
};

function isValidMessage(value: unknown): value is OutboxMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<OutboxMessage>;
  return (
    (record.kind === 'room' || record.kind === 'direct') &&
    typeof record.ownerId === 'string' &&
    typeof record.contextId === 'string' &&
    typeof record.clientMessageId === 'string' &&
    typeof record.body === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.attempt === 'number' &&
    typeof record.nextAttemptAt === 'string'
  );
}

function parseMessages(raw: string | null): OutboxMessage[] | null {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const cutoff = Date.now() - outboxLimits.maxAgeMs;
  return parsed
    .filter(isValidMessage)
    .filter(message => new Date(message.createdAt).getTime() >= cutoff)
    .slice(-outboxLimits.messages);
}

function fitStorageLimit(messages: OutboxMessage[]): OutboxMessage[] {
  const result = messages.slice(-outboxLimits.messages);
  while (
    result.length > 0 &&
    JSON.stringify(result).length > outboxLimits.maxSerializedCharacters
  ) {
    result.shift();
  }
  return result;
}

async function readAllUnlocked(): Promise<OutboxMessage[]> {
  const raw = await secureStorage.getItem(storageKey);
  const parsed = parseMessages(raw);
  if (parsed !== null) {
    if (raw && JSON.stringify(parsed) !== raw) await writeAllUnlocked(parsed);
    return parsed;
  }

  const backup = await secureStorage.getItem(backupStorageKey);
  const recovered = parseMessages(backup);
  if (recovered !== null && recovered.length > 0) {
    await secureStorage.setItem(storageKey, JSON.stringify(recovered));
    await secureStorage.removeItem(backupStorageKey);
    return recovered;
  }
  await secureStorage.removeItem(storageKey);
  await secureStorage.removeItem(backupStorageKey);
  return [];
}

async function writeAllUnlocked(messages: OutboxMessage[]): Promise<void> {
  const fitted = fitStorageLimit(messages);
  if (fitted.length === 0) {
    await secureStorage.removeItem(storageKey);
    await secureStorage.removeItem(backupStorageKey);
    return;
  }
  const previous = await secureStorage.getItem(storageKey);
  if (previous) await secureStorage.setItem(backupStorageKey, previous);
  await secureStorage.setItem(storageKey, JSON.stringify(fitted));
  await secureStorage.removeItem(backupStorageKey);
}

function withStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation, operation);
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function enqueueOutbox(message: OutboxMessage): Promise<void> {
  await withStorageLock(async () => {
    const current = await readAllUnlocked();
    if (current.some(item => item.clientMessageId === message.clientMessageId))
      return;
    await writeAllUnlocked([...current, message]);
  });
}

export async function removeFromOutbox(
  ownerId: string,
  clientMessageId: string,
): Promise<void> {
  await withStorageLock(async () => {
    const current = await readAllUnlocked();
    await writeAllUnlocked(
      current.filter(
        message =>
          message.ownerId !== ownerId ||
          message.clientMessageId !== clientMessageId,
      ),
    );
  });
}

export async function listOutbox(
  ownerId: string,
  kind: OutboxKind,
  contextId: string,
): Promise<OutboxMessage[]> {
  return withStorageLock(async () =>
    (await readAllUnlocked()).filter(
      message =>
        message.ownerId === ownerId &&
        message.kind === kind &&
        message.contextId === contextId,
    ),
  );
}

async function listAllOutbox(ownerId: string): Promise<OutboxMessage[]> {
  return withStorageLock(async () =>
    (await readAllUnlocked()).filter(message => message.ownerId === ownerId),
  );
}

async function markAttempt(message: OutboxMessage): Promise<void> {
  await withStorageLock(async () => {
    const current = await readAllUnlocked();
    const attempt = message.attempt + 1;
    const nextAttemptAt = new Date(
      Date.now() + Math.min(60 * 60_000, 2 ** attempt * 1_000),
    ).toISOString();
    await writeAllUnlocked(
      current.map(item =>
        item.ownerId === message.ownerId &&
        item.clientMessageId === message.clientMessageId
          ? { ...item, attempt, nextAttemptAt }
          : item,
      ),
    );
  });
}

const activeFlushes = new Map<string, Promise<void>>();

export async function flushAllOutbox(
  ownerId: string,
  sender: (message: OutboxMessage) => Promise<void>,
): Promise<void> {
  const existing = activeFlushes.get(ownerId);
  if (existing) return existing;
  const flush = (async () => {
    const now = Date.now();
    const pending = (await listAllOutbox(ownerId)).filter(
      message => new Date(message.nextAttemptAt).getTime() <= now,
    );
    for (const message of pending) {
      try {
        await sender(message);
        await removeFromOutbox(ownerId, message.clientMessageId);
      } catch {
        await markAttempt(message);
        break;
      }
    }
  })().finally(() => activeFlushes.delete(ownerId));
  activeFlushes.set(ownerId, flush);
  return flush;
}
