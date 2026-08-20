import {
  applyAbortSignal,
  createTimeoutFetch,
  RequestTimeoutError,
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
});
