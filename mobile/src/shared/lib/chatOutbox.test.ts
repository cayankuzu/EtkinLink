const mockStorage = new Map<string, string>();

jest.mock('./secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
  },
}));

import {
  enqueueOutbox,
  flushAllOutbox,
  listDeadLetters,
  listOutbox,
  type OutboxMessage,
  purgeAllOutbox,
  purgeOutboxForOwner,
  removeFromOutbox,
} from './chatOutbox';

function message(
  index: number,
  overrides: Partial<OutboxMessage> = {},
): OutboxMessage {
  return {
    ownerId: 'user-1',
    kind: 'direct',
    contextId: 'match-1',
    clientMessageId: `client-${index}`,
    body: `mesaj-${index}`,
    createdAt: new Date(Date.now() + index).toISOString(),
    attempt: 0,
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    ...overrides,
  };
}

describe('güvenli sohbet gönderim kuyruğu', () => {
  beforeEach(() => mockStorage.clear());

  it('aynı istemci mesajını iki kez eklemez', async () => {
    await enqueueOutbox(message(1));
    await enqueueOutbox(message(1));
    expect(await listOutbox('user-1', 'direct', 'match-1')).toHaveLength(1);
  });

  it('eşzamanlı eklemelerde mesaj kaybetmez', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => enqueueOutbox(message(index))),
    );
    expect(await listOutbox('user-1', 'direct', 'match-1')).toHaveLength(20);
  });

  it('en fazla 40 mesaj tutar', async () => {
    for (let index = 0; index < 45; index += 1)
      await enqueueOutbox(message(index));
    const items = await listOutbox('user-1', 'direct', 'match-1');
    expect(items).toHaveLength(40);
    expect(items[0]?.clientMessageId).toBe('client-5');
  });

  it('güvenli depolama boyut sınırında en yeni mesajları korur', async () => {
    for (let index = 0; index < 10; index += 1) {
      await enqueueOutbox(message(index, { body: 'x'.repeat(10_000) }));
    }
    const items = await listOutbox('user-1', 'direct', 'match-1');
    expect(items.length).toBeLessThan(10);
    expect(items.at(-1)?.clientMessageId).toBe('client-9');
    expect(
      (mockStorage.get('chat-outbox-v1') ?? '').length,
    ).toBeLessThanOrEqual(48_000);
  });

  it('yedi günden eski mesajı döndürmez', async () => {
    await enqueueOutbox(
      message(1, {
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
      }),
    );
    expect(await listOutbox('user-1', 'direct', 'match-1')).toHaveLength(0);
  });

  it('FIFO gönderir ve ilk hatada kuyruğu durdurur', async () => {
    await enqueueOutbox(message(1));
    await enqueueOutbox(message(2));
    await enqueueOutbox(message(3));
    const sent: string[] = [];
    await flushAllOutbox('user-1', async item => {
      sent.push(item.clientMessageId);
      if (item.clientMessageId === 'client-2') throw new Error('ağ kesildi');
    });
    expect(sent).toEqual(['client-1', 'client-2']);
    expect(
      (await listOutbox('user-1', 'direct', 'match-1')).map(
        item => item.clientMessageId,
      ),
    ).toEqual(['client-2', 'client-3']);
  });

  it('başarısız gönderimi artan backoff ile erteler ve süresi gelmeden tekrar denemez', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    await enqueueOutbox(message(1));
    const sender = jest
      .fn<Promise<void>, [OutboxMessage]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    await flushAllOutbox('user-1', sender);
    const queued = await listOutbox('user-1', 'direct', 'match-1');
    expect(queued[0]).toMatchObject({ attempt: 1 });
    expect(new Date(queued[0]?.nextAttemptAt ?? 0).getTime()).toBe(
      Date.now() + 2_000,
    );

    await flushAllOutbox('user-1', sender);
    expect(sender).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2_000);
    await flushAllOutbox('user-1', sender);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);
    jest.useRealTimers();
  });

  it('maksimum denemeden sonra dead-letter olur ve otomatik replay durur', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
    await enqueueOutbox(message(1));
    const sender = jest.fn(async () => {
      throw new Error('provider unavailable');
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await flushAllOutbox('user-1', sender);
      jest.advanceTimersByTime(Math.min(60 * 60_000, 2 ** attempt * 1_000));
    }

    expect(await listDeadLetters('user-1', 'direct', 'match-1')).toEqual([
      expect.objectContaining({
        attempt: 5,
        deadLetteredAt: expect.any(String),
      }),
    ]);
    await flushAllOutbox('user-1', sender);
    expect(sender).toHaveBeenCalledTimes(5);
    jest.useRealTimers();
  });

  it('aynı kullanıcı için eşzamanlı flush taleplerini tek replay uçuşunda birleştirir', async () => {
    await enqueueOutbox(message(1));
    let completeDelivery: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const delivery = new Promise<void>(resolve => {
      completeDelivery = resolve;
    });
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const sender = jest.fn(() => {
      markStarted();
      return delivery;
    });

    const first = flushAllOutbox('user-1', sender);
    const second = flushAllOutbox('user-1', sender);
    await started;
    expect(sender).toHaveBeenCalledTimes(1);
    completeDelivery();
    await Promise.all([first, second]);

    expect(sender).toHaveBeenCalledTimes(1);
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);
  });

  it('başarılı mesajı kuyruktan kaldırır', async () => {
    await enqueueOutbox(message(1));
    await removeFromOutbox('user-1', 'client-1');
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);
  });

  it('bozuk veya beklenmeyen yerel veriyi güvenle yok sayar', async () => {
    mockStorage.set('chat-outbox-v1', '{bozuk-json');
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);

    mockStorage.set('chat-outbox-v1', JSON.stringify({ unexpected: true }));
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);

    const validMessage = message(1);
    mockStorage.set(
      'chat-outbox-v1',
      JSON.stringify([null, { kind: 'direct' }, validMessage]),
    );
    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([
      validMessage,
    ]);
    expect(JSON.parse(mockStorage.get('chat-outbox-v1') ?? '[]')).toEqual([
      validMessage,
    ]);
  });

  it('yarım kalan yazmadan sonra yedekten kurtarır', async () => {
    const recoverable = message(7);
    mockStorage.set('chat-outbox-v1', '{yarım-yazma');
    mockStorage.set('chat-outbox-v1-backup', JSON.stringify([recoverable]));

    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([
      recoverable,
    ]);
    expect(mockStorage.has('chat-outbox-v1-backup')).toBe(false);
  });
});

describe('outbox privacy purge', () => {
  beforeEach(() => mockStorage.clear());

  it("purges one owner without deleting another owner's messages", async () => {
    await enqueueOutbox(message(1));
    await enqueueOutbox(message(2, { ownerId: 'user-2' }));

    await purgeOutboxForOwner('user-1');

    expect(await listOutbox('user-1', 'direct', 'match-1')).toEqual([]);
    expect(await listOutbox('user-2', 'direct', 'match-1')).toEqual([
      expect.objectContaining({ clientMessageId: 'client-2' }),
    ]);
  });

  it('purges both primary and backup outbox storage', async () => {
    await enqueueOutbox(message(1));
    mockStorage.set('chat-outbox-v1-backup', JSON.stringify([message(2)]));

    await purgeAllOutbox();

    expect(mockStorage.has('chat-outbox-v1')).toBe(false);
    expect(mockStorage.has('chat-outbox-v1-backup')).toBe(false);
  });
});
