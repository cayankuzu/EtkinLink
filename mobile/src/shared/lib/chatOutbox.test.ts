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
  flushOutbox,
  listOutbox,
  type OutboxMessage,
  removeFromOutbox,
} from './chatOutbox';

function message(
  index: number,
  overrides: Partial<OutboxMessage> = {},
): OutboxMessage {
  return {
    kind: 'direct',
    contextId: 'match-1',
    clientMessageId: `client-${index}`,
    body: `mesaj-${index}`,
    createdAt: new Date(Date.now() + index).toISOString(),
    ...overrides,
  };
}

describe('güvenli sohbet gönderim kuyruğu', () => {
  beforeEach(() => mockStorage.clear());

  it('aynı istemci mesajını iki kez eklemez', async () => {
    await enqueueOutbox(message(1));
    await enqueueOutbox(message(1));
    expect(await listOutbox('direct', 'match-1')).toHaveLength(1);
  });

  it('en fazla 40 mesaj tutar', async () => {
    for (let index = 0; index < 45; index += 1)
      await enqueueOutbox(message(index));
    const items = await listOutbox('direct', 'match-1');
    expect(items).toHaveLength(40);
    expect(items[0]?.clientMessageId).toBe('client-5');
  });

  it('yedi günden eski mesajı döndürmez', async () => {
    await enqueueOutbox(
      message(1, {
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
      }),
    );
    expect(await listOutbox('direct', 'match-1')).toHaveLength(0);
  });

  it('FIFO gönderir ve ilk hatada kuyruğu durdurur', async () => {
    await enqueueOutbox(message(1));
    await enqueueOutbox(message(2));
    await enqueueOutbox(message(3));
    const sent: string[] = [];
    await flushOutbox('direct', 'match-1', async item => {
      sent.push(item.clientMessageId);
      if (item.clientMessageId === 'client-2') throw new Error('ağ kesildi');
    });
    expect(sent).toEqual(['client-1', 'client-2']);
    expect(
      (await listOutbox('direct', 'match-1')).map(item => item.clientMessageId),
    ).toEqual(['client-2', 'client-3']);
  });

  it('başarılı mesajı kuyruktan kaldırır', async () => {
    await enqueueOutbox(message(1));
    await removeFromOutbox('client-1');
    expect(await listOutbox('direct', 'match-1')).toEqual([]);
  });

  it('bozuk veya beklenmeyen yerel veriyi güvenle yok sayar', async () => {
    mockStorage.set('chat-outbox-v1', '{bozuk-json');
    expect(await listOutbox('direct', 'match-1')).toEqual([]);

    mockStorage.set('chat-outbox-v1', JSON.stringify({ unexpected: true }));
    expect(await listOutbox('direct', 'match-1')).toEqual([]);

    const validMessage = message(1);
    mockStorage.set(
      'chat-outbox-v1',
      JSON.stringify([null, { kind: 'direct' }, validMessage]),
    );
    expect(await listOutbox('direct', 'match-1')).toEqual([validMessage]);
  });
});
