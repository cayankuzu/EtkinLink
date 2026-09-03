import {
  assertAllowedEtkinlikApiUrl,
  assertAllowedEventsUrl,
  EVENTS_API_URL,
  fetchBoundedJson,
  parseEtkinlikPublicEventUrl,
  parseRetryAfterMs,
  readBoundedJson,
  retryDelayMs,
  UpstreamHttpError,
} from "./upstreamHttp.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${message}: ${left} !== ${right}`);
}

async function assertRejectsWithCode(
  action: () => Promise<unknown>,
  expectedCode: string,
) {
  try {
    await action();
  } catch (error) {
    assert(
      error instanceof UpstreamHttpError,
      "UpstreamHttpError bekleniyordu",
    );
    assertEquals(error.message, expectedCode, "hata kodu");
    return;
  }
  throw new Error(`${expectedCode} hatası bekleniyordu`);
}

Deno.test("yalnızca sabit HTTPS etkinlik uç noktası ve bilinen sorgular kabul edilir", () => {
  const allowed = assertAllowedEventsUrl(
    `${EVENTS_API_URL}?start_gte=2026-08-30&sort_by=updated&skip=0&take=50`,
  );
  assertEquals(allowed.origin, "https://etkinlik.io", "allowlist origin");

  for (
    const rejected of [
      "http://etkinlik.io/api/v2/events",
      "https://evil.example/api/v2/events",
      "https://etkinlik.io/api/v2/events?redirect=https://evil.example",
      "https://user:password@etkinlik.io/api/v2/events",
    ]
  ) {
    try {
      assertAllowedEventsUrl(rejected);
      throw new Error(`URL reddedilmeliydi: ${rejected}`);
    } catch (error) {
      assert(error instanceof UpstreamHttpError, "allowlist hata türü");
      assertEquals(error.message, "UPSTREAM_URL_NOT_ALLOWED", "allowlist kodu");
    }
  }
});

Deno.test("yalnız katalog, event listesi ve sayısal event detay yolları kabul edilir", () => {
  for (
    const allowed of [
      "https://etkinlik.io/api/v2/cities",
      "https://etkinlik.io/api/v2/formats",
      "https://etkinlik.io/api/v2/categories",
      "https://etkinlik.io/api/v2/events/42",
      "https://etkinlik.io/api/v2/events?city_ids=34&format_ids=7&end_lte=2026-09-01",
    ]
  ) {
    assertEquals(
      assertAllowedEtkinlikApiUrl(allowed).origin,
      "https://etkinlik.io",
      "allowlist origin",
    );
  }

  for (
    const rejected of [
      "https://etkinlik.io/api/v2/events/0",
      "https://etkinlik.io/api/v2/events/not-a-number",
      "https://etkinlik.io/api/v2/users",
      "https://etkinlik.io/api/v2/cities?redirect=https://evil.example",
      "https://etkinlik.io/api/v2/cities?take=1",
      "https://etkinlik.io/api/v2/events/42?take=1",
      "https://etkinlik.io/api/v2/events?take=51",
      "https://etkinlik.io/api/v2/events?skip=-1",
      "https://etkinlik.io/api/v2/events?sort_by=unknown",
      "https://etkinlik.io/api/v2/events?city_ids=1,,2",
      "https://etkinlik.io/api/v2/events?take=10&take=20",
      "https://etkinlik.io/api/v2/events?start_gte=tomorrow",
    ]
  ) {
    try {
      assertAllowedEtkinlikApiUrl(rejected);
      throw new Error(`URL reddedilmeliydi: ${rejected}`);
    } catch (error) {
      assert(error instanceof UpstreamHttpError, "allowlist hata türü");
      assertEquals(error.message, "UPSTREAM_URL_NOT_ALLOWED", "allowlist kodu");
    }
  }
});

Deno.test("public event URL'si exact origin, güvenli slug ve sayısal kimlik ister", () => {
  assertEquals(
    parseEtkinlikPublicEventUrl("https://etkinlik.io/etkinlik/42/guvenli-slug"),
    {
      eventId: 42,
      url: "https://etkinlik.io/etkinlik/42/guvenli-slug",
    },
    "public detail",
  );
  for (
    const rejected of [
      "https://evil.example/etkinlik/42/guvenli-slug",
      "https://etkinlik.io/etkinlik/42/%2fadmin",
      "https://etkinlik.io/etkinlik/42/../admin",
      "https://etkinlik.io/etkinlik/42?next=evil",
      "https://user:pass@etkinlik.io/etkinlik/42",
      "https://etkinlik.io/etkinlik/0",
    ]
  ) {
    assertEquals(parseEtkinlikPublicEventUrl(rejected), null, rejected);
  }
});

Deno.test("upstream transport yalnız GET ve gövdesiz çağrı kabul eder", async () => {
  await assertRejectsWithCode(
    () => fetchBoundedJson(EVENTS_API_URL, { method: "POST" }),
    "UPSTREAM_METHOD_NOT_ALLOWED",
  );
  await assertRejectsWithCode(
    () => fetchBoundedJson(EVENTS_API_URL, { body: "{}" }),
    "UPSTREAM_METHOD_NOT_ALLOWED",
  );
});

Deno.test("Retry-After saniye ve HTTP tarihini güvenli gecikmeye çevirir", () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  assertEquals(parseRetryAfterMs("2", now), 2_000, "saniye biçimi");
  assertEquals(
    parseRetryAfterMs("Sun, 30 Aug 2026 12:00:05 GMT", now),
    5_000,
    "tarih biçimi",
  );
  assertEquals(parseRetryAfterMs("bozuk", now), null, "bozuk değer");
  assertEquals(retryDelayMs(1, null, now, 0.5), 250, "jitter gecikmesi");
  assertEquals(retryDelayMs(0, "30", now, 0), 10_000, "üst sınır");
});

Deno.test("JSON içerik türü, Content-Length ve akış boyutu ayrı ayrı sınırlandırılır", async () => {
  const value = await readBoundedJson(
    new Response('{"items":[1]}', {
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    64,
  );
  assertEquals(value, { items: [1] }, "geçerli JSON");

  await assertRejectsWithCode(
    () =>
      readBoundedJson(
        new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "65",
          },
        }),
        64,
      ),
    "UPSTREAM_BODY_TOO_LARGE",
  );
  await assertRejectsWithCode(
    () =>
      readBoundedJson(
        new Response("x".repeat(65), {
          headers: { "content-type": "application/json" },
        }),
        64,
      ),
    "UPSTREAM_BODY_TOO_LARGE",
  );
  await assertRejectsWithCode(
    () =>
      readBoundedJson(
        new Response("{}", { headers: { "content-type": "text/html" } }),
        64,
      ),
    "UPSTREAM_CONTENT_TYPE",
  );
});

Deno.test("429 ve 5xx en fazla üç denemede Retry-After ve jitter ile tekrar edilir", async () => {
  const responses = [
    new Response("", { status: 429, headers: { "retry-after": "2" } }),
    new Response("", { status: 503 }),
    new Response('{"items":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ];
  const delays: number[] = [];
  const redirects: Array<RequestRedirect | undefined> = [];
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    redirects.push(init?.redirect);
    const response = responses.shift();
    if (!response) throw new Error("beklenmeyen fetch");
    return response;
  }) as typeof fetch;

  const result = await fetchBoundedJson(
    `${EVENTS_API_URL}?skip=0&take=50`,
    { headers: { accept: "application/json" } },
    {
      fetch: fetchImpl,
      now: () => Date.parse("2026-08-30T12:00:00Z"),
      random: () => 0.5,
      sleep: (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    },
  );

  assertEquals(result, { items: [] }, "başarılı son yanıt");
  assertEquals(delays, [2_000, 250], "retry gecikmeleri");
  assertEquals(redirects, ["manual", "manual", "manual"], "redirect modu");
});

Deno.test("redirect izlenmez ve son 5xx yanıtından sonra deneme sonlanır", async () => {
  let redirectFetches = 0;
  await assertRejectsWithCode(
    () =>
      fetchBoundedJson(
        EVENTS_API_URL,
        {},
        {
          fetch: (async () => {
            redirectFetches += 1;
            return new Response("", {
              status: 302,
              headers: { location: "https://evil.example" },
            });
          }) as typeof fetch,
          sleep: () => Promise.resolve(),
        },
      ),
    "UPSTREAM_REDIRECT",
  );
  assertEquals(redirectFetches, 1, "redirect tekrar edilmez");

  let unavailableFetches = 0;
  await assertRejectsWithCode(
    () =>
      fetchBoundedJson(
        EVENTS_API_URL,
        {},
        {
          fetch: (async () => {
            unavailableFetches += 1;
            return new Response("", { status: 503 });
          }) as typeof fetch,
          random: () => 0,
          sleep: () => Promise.resolve(),
        },
      ),
    "UPSTREAM_503",
  );
  assertEquals(unavailableFetches, 3, "sınırlı deneme sayısı");
});
