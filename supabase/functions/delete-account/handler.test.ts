import {
  type AccountDeletionDependencies,
  type AccountDeletionPhase,
  type AccountDeletionState,
  createDeleteAccountHandler,
  MAX_REQUEST_BODY_BYTES,
  MAX_STORAGE_OBJECTS_PER_INVOCATION,
  RECENT_LOGIN_WINDOW_MS,
} from "./handler.ts";

const NOW_MS = Date.parse("2026-08-30T12:00:00.000Z");
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      message ?? `expected ${expectedJson}, received ${actualJson}`,
    );
  }
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function request(
  clientRequestId = REQUEST_A,
  token = "token-a",
): Request {
  return new Request("https://example.test/functions/v1/delete-account", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ client_request_id: clientRequestId }),
  });
}

type DeleteBehavior = "success" | "fail" | "response-loss";

type FakeOptions = {
  request?: AccountDeletionState | null;
  authExists?: boolean;
  lastSignInAt?: string | null;
  issuedAt?: number;
  storagePaths?: string[];
  deleteBehavior?: DeleteBehavior;
  storageDeleteFailures?: number;
};

function state(
  phase: AccountDeletionPhase,
  userId = USER_A,
): AccountDeletionState {
  return {
    userId,
    clientRequestId: REQUEST_A,
    phase,
    recentLoginVerifiedAt: new Date(NOW_MS).toISOString(),
    attemptCount: 0,
    lastErrorCode: null,
    updatedAt: new Date(NOW_MS).toISOString(),
  };
}

function fakeDependencies(options: FakeOptions = {}) {
  const fake = {
    request: options.request === undefined ? null : options.request,
    authExists: options.authExists ?? true,
    lastSignInAt: options.lastSignInAt === undefined
      ? new Date(NOW_MS - 30_000).toISOString()
      : options.lastSignInAt,
    issuedAt: options.issuedAt ?? Math.floor((NOW_MS - 30_000) / 1000),
    storage: new Set(options.storagePaths ?? []),
    deleteBehavior: options.deleteBehavior ?? "success" as DeleteBehavior,
    storageDeleteFailures: options.storageDeleteFailures ?? 0,
    beginCalls: 0,
    authStateCalls: 0,
    authDeleteCalls: 0,
    listCalls: 0,
    removeCalls: 0,
    events: [] as string[],
  };

  const dependencies: AccountDeletionDependencies = {
    now: () => NOW_MS,
    verifyToken(token) {
      if (token === "token-a") {
        return Promise.resolve({ sub: USER_A, iat: fake.issuedAt });
      }
      if (token === "token-b") {
        return Promise.resolve({ sub: USER_B, iat: fake.issuedAt });
      }
      return Promise.reject(new Error("invalid token"));
    },
    getRequest(clientRequestId) {
      return Promise.resolve(
        fake.request?.clientRequestId === clientRequestId
          ? { ...fake.request }
          : null,
      );
    },
    beginRequest(userId, clientRequestId) {
      fake.beginCalls += 1;
      if (!fake.request) {
        fake.request = {
          ...state("requested", userId),
          clientRequestId,
        };
      }
      return Promise.resolve({ ...fake.request });
    },
    advanceRequest(
      userId,
      clientRequestId,
      expectedPhase,
      nextPhase,
      errorCode,
    ) {
      if (
        !fake.request ||
        fake.request.userId !== userId ||
        fake.request.clientRequestId !== clientRequestId ||
        fake.request.phase !== expectedPhase
      ) {
        return Promise.reject(new Error("state conflict"));
      }
      fake.request = {
        ...fake.request,
        phase: nextPhase,
        attemptCount: fake.request.attemptCount + 1,
        lastErrorCode: errorCode,
      };
      return Promise.resolve({ ...fake.request });
    },
    getAuthState() {
      fake.authStateCalls += 1;
      return Promise.resolve({
        exists: fake.authExists,
        lastSignInAt: fake.lastSignInAt,
      });
    },
    deleteAuthUser() {
      fake.authDeleteCalls += 1;
      fake.events.push("auth-delete");
      if (fake.deleteBehavior === "fail") {
        return Promise.reject(new Error("auth failure"));
      }
      fake.authExists = false;
      if (fake.deleteBehavior === "response-loss") {
        return Promise.reject(new Error("response lost"));
      }
      return Promise.resolve();
    },
    listStoragePaths(userId, _clientRequestId, after, pageSize) {
      fake.listCalls += 1;
      fake.events.push("storage-list");
      return Promise.resolve(
        [...fake.storage]
          .filter((path) =>
            path.slice(0, userId.length).toLowerCase() === userId &&
            path[userId.length] === "/" &&
            path > (after ?? "")
          )
          .sort()
          .slice(0, pageSize),
      );
    },
    removeStoragePaths(paths) {
      fake.removeCalls += 1;
      fake.events.push("storage-remove");
      if (fake.storageDeleteFailures > 0) {
        fake.storageDeleteFailures -= 1;
        return Promise.reject(new Error("storage failure"));
      }
      for (const path of paths) fake.storage.delete(path);
      return Promise.resolve();
    },
  };

  return { dependencies, fake };
}

Deno.test("requires POST, application/json, a bounded body, and a UUID v4", async () => {
  const { dependencies } = fakeDependencies();
  const handler = createDeleteAccountHandler(dependencies);

  const getResponse = await handler(
    new Request("https://example.test/functions/v1/delete-account"),
  );
  assertEquals(getResponse.status, 405);
  assertEquals((await responseBody(getResponse)).code, "METHOD_NOT_ALLOWED");

  const mediaResponse = await handler(
    new Request("https://example.test/functions/v1/delete-account", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }),
  );
  assertEquals(mediaResponse.status, 415);

  const invalidIdResponse = await handler(request("not-a-uuid"));
  assertEquals(invalidIdResponse.status, 400);
  assertEquals(
    (await responseBody(invalidIdResponse)).code,
    "INVALID_CLIENT_REQUEST_ID",
  );

  const oversizedResponse = await handler(
    new Request("https://example.test/functions/v1/delete-account", {
      method: "POST",
      headers: {
        authorization: "Bearer token-a",
        "content-type": "application/json",
        "content-length": String(MAX_REQUEST_BODY_BYTES + 1),
      },
      body: "{}",
    }),
  );
  assertEquals(oversizedResponse.status, 413);
  assertEquals(
    (await responseBody(oversizedResponse)).code,
    "REQUEST_BODY_TOO_LARGE",
  );
});

Deno.test("rejects stale JWT issue time before creating deletion state", async () => {
  const { dependencies, fake } = fakeDependencies({
    issuedAt: Math.floor((NOW_MS - RECENT_LOGIN_WINDOW_MS - 1_000) / 1000),
  });
  const response = await createDeleteAccountHandler(dependencies)(request());

  assertEquals(response.status, 403);
  assertEquals((await responseBody(response)).code, "RECENT_LOGIN_REQUIRED");
  assertEquals(fake.beginCalls, 0);
  assertEquals(fake.authDeleteCalls, 0);
  assertEquals(fake.removeCalls, 0);
});

Deno.test("rejects stale last_sign_in_at before creating deletion state", async () => {
  const { dependencies, fake } = fakeDependencies({
    lastSignInAt: new Date(
      NOW_MS - RECENT_LOGIN_WINDOW_MS - 1_000,
    ).toISOString(),
  });
  const response = await createDeleteAccountHandler(dependencies)(request());

  assertEquals(response.status, 403);
  assertEquals((await responseBody(response)).code, "RECENT_LOGIN_REQUIRED");
  assertEquals(fake.beginCalls, 0);
  assertEquals(fake.authDeleteCalls, 0);
});

Deno.test("refuses a request id owned by another verified subject", async () => {
  const { dependencies, fake } = fakeDependencies({
    request: state("storage_deleting", USER_A),
    authExists: false,
  });
  const response = await createDeleteAccountHandler(dependencies)(
    request(REQUEST_A, "token-b"),
  );

  assertEquals(response.status, 403);
  assertEquals((await responseBody(response)).code, "REQUEST_OWNER_MISMATCH");
  assertEquals(fake.authStateCalls, 0);
  assertEquals(fake.listCalls, 0);
});

Deno.test("returns completed requests idempotently after the auth user is gone", async () => {
  const { dependencies, fake } = fakeDependencies({
    request: state("completed"),
    authExists: false,
  });
  const response = await createDeleteAccountHandler(dependencies)(request());

  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), {
    client_request_id: REQUEST_A,
    deleted: true,
    idempotent: true,
    phase: "completed",
  });
  assertEquals(fake.authStateCalls, 0);
  assertEquals(fake.authDeleteCalls, 0);
  assertEquals(fake.listCalls, 0);
});

Deno.test("never touches Storage when Auth deletion fails", async () => {
  const photo = `${USER_A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const { dependencies, fake } = fakeDependencies({
    storagePaths: [photo],
    deleteBehavior: "fail",
  });
  const response = await createDeleteAccountHandler(dependencies)(request());

  assertEquals(response.status, 502);
  assertEquals((await responseBody(response)).code, "AUTH_DELETE_FAILED");
  assertEquals(fake.authDeleteCalls, 1);
  assertEquals(fake.listCalls, 0);
  assertEquals(fake.removeCalls, 0);
  assert(fake.storage.has(photo));
  assertEquals(fake.request?.phase, "requested");
  assertEquals(fake.request?.lastErrorCode, "AUTH_DELETE_FAILED");
});

Deno.test("recovers a lost Auth response and retries without duplicate deletion", async () => {
  const photo = `${USER_A}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const { dependencies, fake } = fakeDependencies({
    storagePaths: [photo],
    deleteBehavior: "response-loss",
  });
  const handler = createDeleteAccountHandler(dependencies);

  const first = await handler(request());
  assertEquals(first.status, 200);
  assertEquals((await responseBody(first)).idempotent, false);
  assertEquals(fake.events[0], "auth-delete");
  assertEquals(fake.authDeleteCalls, 1);
  assertEquals(fake.removeCalls, 1);
  assertEquals(fake.storage.size, 0);

  const retry = await handler(request());
  assertEquals(retry.status, 200);
  assertEquals((await responseBody(retry)).idempotent, true);
  assertEquals(fake.authDeleteCalls, 1);
  assertEquals(fake.removeCalls, 1);
});

Deno.test("resumes auth_deleted with recursive Storage pagination", async () => {
  const paths = Array.from({ length: 205 }, (_, index) => {
    const folder = index % 2 === 0 ? "nested/a" : "nested/b/deeper";
    return `${USER_A}/${folder}/${String(index).padStart(4, "0")}.jpg`;
  });
  paths.push(`${USER_A.toUpperCase()}/legacy/uppercase-owner.jpg`);
  const { dependencies, fake } = fakeDependencies({
    request: state("auth_deleted"),
    authExists: false,
    storagePaths: paths,
  });
  const response = await createDeleteAccountHandler(dependencies)(request());

  assertEquals(response.status, 200);
  assertEquals(fake.authStateCalls, 0);
  assertEquals(fake.authDeleteCalls, 0);
  assertEquals(fake.removeCalls, 3);
  assert(fake.listCalls >= 4, "expected three pages and an empty page");
  assertEquals(fake.storage.size, 0);
  assertEquals(fake.request?.phase, "completed");
});

Deno.test("returns 202 at the cleanup bound and continues with the same id", async () => {
  const paths = Array.from(
    { length: MAX_STORAGE_OBJECTS_PER_INVOCATION },
    (_, index) => `${USER_A}/legacy/${String(index).padStart(5, "0")}.jpg`,
  );
  const { dependencies, fake } = fakeDependencies({
    request: state("storage_deleting"),
    authExists: false,
    storagePaths: paths,
  });
  const handler = createDeleteAccountHandler(dependencies);

  const bounded = await handler(request());
  assertEquals(bounded.status, 202);
  assertEquals(await responseBody(bounded), {
    client_request_id: REQUEST_A,
    deleted: false,
    phase: "storage_deleting",
    resumable: true,
  });
  assertEquals(fake.request?.phase, "storage_deleting");
  assertEquals(fake.storage.size, 0);
  assertEquals(fake.authDeleteCalls, 0);

  const continuation = await handler(request());
  assertEquals(continuation.status, 200);
  assertEquals((await responseBody(continuation)).phase, "completed");
  assertEquals(fake.request?.phase, "completed");
  assertEquals(fake.authDeleteCalls, 0);
});

Deno.test("persists Storage cleanup failure and completes on retry", async () => {
  const photo = `${USER_A}/nested/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`;
  const { dependencies, fake } = fakeDependencies({
    request: state("storage_deleting"),
    authExists: false,
    storagePaths: [photo],
    storageDeleteFailures: 1,
  });
  const handler = createDeleteAccountHandler(dependencies);

  const first = await handler(request());
  assertEquals(first.status, 502);
  assertEquals((await responseBody(first)).code, "STORAGE_DELETE_FAILED");
  assertEquals(fake.request?.phase, "storage_deleting");
  assertEquals(fake.request?.lastErrorCode, "STORAGE_DELETE_FAILED");
  assert(fake.storage.has(photo));

  const retry = await handler(request());
  assertEquals(retry.status, 200);
  assertEquals(fake.request?.phase, "completed");
  assertEquals(fake.storage.size, 0);
  assertEquals(fake.authDeleteCalls, 0);
});
