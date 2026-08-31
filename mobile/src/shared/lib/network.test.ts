import {
  applyAbortSignal,
  createRetryingGetFetch,
  createTimeoutFetch,
  parseRetryAfterMs,
  readResponseTextLimited,
  RequestTimeoutError,
  ResponseTooLargeError,
} from './network';

describe('network timeout ve cancellation', () => {
  afterEach(() => jest.useRealTimers());

  it('timeout olduğunda anlamlı hata ve abort üretir', async () => {
    jest.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const baseFetch = jest.fn((_input, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      });
    }) as unknown as typeof fetch;
    const request = createTimeoutFetch(
      baseFetch,
      2_000,
    )('https://example.test');
    const result = request.catch(error => error);

    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('ekran AbortSignal iptalini timeout hatasına dönüştürmeden iletir', async () => {
    const upstream = new AbortController();
    const expected = new Error('ekran kapandı');
    const baseFetch = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(expected));
      });
    }) as unknown as typeof fetch;
    const request = createTimeoutFetch(baseFetch, 30_000)(
      'https://example.test',
      { signal: upstream.signal },
    );

    upstream.abort();

    await expect(request).rejects.toBe(expected);
  });

  it('Supabase builder üzerine sinyali yalnız verildiğinde uygular', () => {
    type Builder = {
      abortSignal: jest.Mock<Builder, [AbortSignal]>;
    };
    const builder = {} as Builder;
    builder.abortSignal = jest.fn((_signal: AbortSignal) => builder);
    const controller = new AbortController();

    expect(applyAbortSignal(builder)).toBe(builder);
    expect(builder.abortSignal).not.toHaveBeenCalled();
    expect(applyAbortSignal(builder, controller.signal)).toBe(builder);
    expect(builder.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it('429 Retry-After değerine uyar ve yalnız GET isteğini tekrarlar', async () => {
    const sleep = jest.fn(async () => undefined);
    const baseFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response('', { status: 429, headers: { 'Retry-After': '2' } }),
      )
      .mockResolvedValueOnce(new Response('ok')) as typeof fetch;
    const retryingFetch = createRetryingGetFetch(baseFetch, {
      sleep,
      random: () => 0,
    });

    await expect(retryingFetch('https://example.test')).resolves.toMatchObject({
      status: 200,
    });
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000, undefined);
    await expect(
      retryingFetch('https://example.test', { method: 'POST' }),
    ).rejects.toThrow('yalnız idempotent GET/HEAD');
  });

  it('HTTP-date Retry-After değerini bounded milisaniyeye çevirir', () => {
    const now = Date.parse('2026-08-30T10:00:00.000Z');
    expect(parseRetryAfterMs('3', now)).toBe(3_000);
    expect(parseRetryAfterMs('Sun, 30 Aug 2026 10:00:04 GMT', now)).toBe(4_000);
    expect(parseRetryAfterMs('bozuk', now)).toBeNull();
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('Content-Length ve gerçek gövde sınırlarını aşan yanıtı reddeder', async () => {
    await expect(
      readResponseTextLimited(
        new Response('x', { headers: { 'Content-Length': '10' } }),
        5,
      ),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    await expect(
      readResponseTextLimited(new Response('abcdef'), 5),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('header geldikten sonra duran gövdeyi timeout ile iptal eder', async () => {
    jest.useFakeTimers();
    const cancel = jest.fn();
    const response = new Response(new ReadableStream({ cancel }) as never);
    const result = readResponseTextLimited(
      response,
      32,
      undefined,
      2_000,
    ).catch(error => error);

    await jest.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('header sonrası gövde okumasına ekran iptalini iletir', async () => {
    const controller = new AbortController();
    const cancel = jest.fn();
    const response = new Response(new ReadableStream({ cancel }) as never);
    const result = readResponseTextLimited(
      response,
      32,
      controller.signal,
    ).catch(error => error);

    controller.abort();

    await expect(result).resolves.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('başarılı timeout fetch sonucunu döndürür ve önceden iptal edilmiş sinyali iletir', async () => {
    const successFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('ok')) as typeof fetch;
    await expect(
      createTimeoutFetch(successFetch, 1_000)('https://example.test'),
    ).resolves.toMatchObject({ status: 200 });

    const controller = new AbortController();
    controller.abort();
    const abortError = Object.assign(new Error('already aborted'), {
      name: 'AbortError',
    });
    const abortedFetch = jest.fn((_input, init) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(abortError);
    }) as unknown as typeof fetch;
    await expect(
      createTimeoutFetch(abortedFetch)('https://example.test', {
        signal: controller.signal,
      }),
    ).rejects.toBe(abortError);
  });

  it('body limit ve timeout seçeneklerini fail-closed doğrular', async () => {
    await expect(
      readResponseTextLimited(new Response('ok'), 0),
    ).rejects.toThrow('maximumBytes');
    await expect(
      readResponseTextLimited(new Response('ok'), 10, undefined, 0),
    ).rejects.toThrow('timeoutMs');

    const controller = new AbortController();
    controller.abort();
    await expect(
      readResponseTextLimited(new Response('ok'), 10, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stream olmayan body yolunda UTF-8 byte hesabını tüm code-point sınıflarında uygular', async () => {
    const value = 'Aé€😀';
    const response = new Response(value);
    Object.defineProperty(response, 'body', { value: null });
    await expect(readResponseTextLimited(response, 10)).resolves.toBe(value);

    const oversized = new Response(value);
    Object.defineProperty(oversized, 'body', { value: null });
    await expect(readResponseTextLimited(oversized, 9)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it('başarılı stream okur ve oversized stream cancel hatasını bastırır', async () => {
    await expect(
      readResponseTextLimited(new Response('stream-ok'), 32),
    ).resolves.toBe('stream-ok');

    const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
    const reader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) }),
      cancel,
    };
    const response = {
      headers: new Headers(),
      body: { getReader: () => reader },
    } as unknown as Response;
    await expect(readResponseTextLimited(response, 1)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(cancel).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const abortCancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
    const abortResponse = {
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => new Promise(() => undefined),
          cancel: abortCancel,
        }),
      },
    } as unknown as Response;
    const abortedRead = readResponseTextLimited(
      abortResponse,
      32,
      controller.signal,
    );
    controller.abort();
    await expect(abortedRead).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(abortCancel).toHaveBeenCalledTimes(1);
  });

  it('network hatasını bounded backoff ile tekrarlar ve son denemede ham hatayı iletir', async () => {
    const sleep = jest.fn(async () => undefined);
    const transient = new Error('network down');
    const baseFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(new Response('ok')) as typeof fetch;
    await expect(
      createRetryingGetFetch(baseFetch, {
        sleep,
        baseDelayMs: 100,
        maximumRetryAfterMs: 80,
        random: () => 1,
      })('https://example.test'),
    ).resolves.toMatchObject({ status: 200 });
    expect(sleep).toHaveBeenCalledWith(80, undefined);

    const finalError = new Error('still offline');
    const failingFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockRejectedValue(finalError) as typeof fetch;
    await expect(
      createRetryingGetFetch(failingFetch, { attempts: 1 })(
        'https://example.test',
      ),
    ).rejects.toBe(finalError);
  });

  it('default sleep tamamlanır ve abort sırasında beklemeyi keser', async () => {
    jest.useFakeTimers();
    const retryingFetch = createRetryingGetFetch(
      jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(new Response('ok')) as typeof fetch,
      { baseDelayMs: 100, random: () => 0 },
    );
    const completed = retryingFetch('https://example.test');
    await jest.advanceTimersByTimeAsync(75);
    await expect(completed).resolves.toMatchObject({ status: 200 });

    const controller = new AbortController();
    const waiting = createRetryingGetFetch(
      jest
        .fn<Promise<Response>, Parameters<typeof fetch>>()
        .mockResolvedValue(new Response(null, { status: 503 })) as typeof fetch,
      { baseDelayMs: 100, random: () => 0 },
    )('https://example.test', { signal: controller.signal });
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('default sleep önceden abort edilmiş sinyali ve geçersiz attempt ayarını reddeder', async () => {
    const controller = new AbortController();
    const abortingFetch = jest.fn(async () => {
      controller.abort();
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    await expect(
      createRetryingGetFetch(abortingFetch)('https://example.test', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      createRetryingGetFetch(jest.fn() as unknown as typeof fetch, {
        attempts: 0,
      })('https://example.test'),
    ).rejects.toThrow('1-5');
  });

  it('Request nesnesindeki HEAD metodunu kabul eder ve kalıcı 4xx yanıtı tekrar etmez', async () => {
    const baseFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(null, { status: 404 })) as typeof fetch;
    const request = new Request('https://example.test', { method: 'HEAD' });

    await expect(
      createRetryingGetFetch(baseFetch)(request),
    ).resolves.toMatchObject({ status: 404 });
    expect(baseFetch).toHaveBeenCalledTimes(1);

    const cancel = jest.fn().mockRejectedValue(new Error('cancel failed'));
    const retryingBaseFetch = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        status: 503,
        headers: new Headers(),
        body: { cancel },
      } as unknown as Response)
      .mockResolvedValueOnce(new Response('ok')) as typeof fetch;
    await expect(
      createRetryingGetFetch(retryingBaseFetch, {
        sleep: async () => undefined,
      })('https://example.test'),
    ).resolves.toMatchObject({ status: 200 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
