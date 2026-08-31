export const MAX_REQUEST_BODY_BYTES = 1024;
export const RECENT_LOGIN_WINDOW_MS = 10 * 60 * 1000;

const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_REMOVE_CHUNK_SIZE = 100;
export const MAX_STORAGE_OBJECTS_PER_INVOCATION = 5_000;
const CLOCK_SKEW_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AccountDeletionPhase =
  | "requested"
  | "auth_deleted"
  | "storage_deleting"
  | "completed";

export type AccountDeletionState = {
  userId: string;
  clientRequestId: string;
  phase: AccountDeletionPhase;
  recentLoginVerifiedAt: string;
  attemptCount: number;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type VerifiedTokenClaims = {
  sub: string;
  iat: number;
};

export type AccountDeletionAuthState = {
  exists: boolean;
  lastSignInAt: string | null;
};

export type AccountDeletionDependencies = {
  now: () => number;
  verifyToken: (token: string) => Promise<VerifiedTokenClaims>;
  getRequest: (
    clientRequestId: string,
  ) => Promise<AccountDeletionState | null>;
  beginRequest: (
    userId: string,
    clientRequestId: string,
  ) => Promise<AccountDeletionState>;
  advanceRequest: (
    userId: string,
    clientRequestId: string,
    expectedPhase: AccountDeletionPhase,
    nextPhase: AccountDeletionPhase,
    errorCode: string | null,
  ) => Promise<AccountDeletionState>;
  getAuthState: (userId: string) => Promise<AccountDeletionAuthState>;
  deleteAuthUser: (userId: string) => Promise<void>;
  listStoragePaths: (
    userId: string,
    clientRequestId: string,
    afterStoragePath: string | null,
    pageSize: number,
  ) => Promise<string[]>;
  removeStoragePaths: (storagePaths: string[]) => Promise<void>;
};

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function errorResponse(status: number, code: string, error: string): Response {
  return jsonResponse(status, { code, error });
}

function mediaType(value: string | null): string {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  if (mediaType(request.headers.get("content-type")) !== "application/json") {
    throw new RequestBodyError(
      415,
      "APPLICATION_JSON_REQUIRED",
      "Content-Type application/json olmalıdır.",
    );
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength.trim())) {
      throw new RequestBodyError(
        400,
        "INVALID_CONTENT_LENGTH",
        "Content-Length geçersiz.",
      );
    }
    if (Number(contentLength) > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyError(
        413,
        "REQUEST_BODY_TOO_LARGE",
        "İstek gövdesi çok büyük.",
      );
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new RequestBodyError(
      400,
      "INVALID_JSON_BODY",
      "Geçerli bir JSON gövdesi gerekli.",
    );
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyError(
          413,
          "REQUEST_BODY_TOO_LARGE",
          "İstek gövdesi çok büyük.",
        );
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(
      400,
      "INVALID_JSON_BODY",
      "Geçerli bir JSON gövdesi gerekli.",
    );
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(parts.join(""));
  } catch {
    throw new RequestBodyError(
      400,
      "INVALID_JSON_BODY",
      "Geçerli bir JSON gövdesi gerekli.",
    );
  }
}

function parseClientRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.client_request_id !== "string" ||
    !UUID_V4_PATTERN.test(record.client_request_id)
  ) {
    return null;
  }
  return record.client_request_id.toLowerCase();
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+([^\s]+)$/i)?.[1] ?? null;
}

function recentLoginIsValid(
  claims: VerifiedTokenClaims,
  lastSignInAt: string | null,
  nowMs: number,
): boolean {
  const issuedAtMs = claims.iat * 1000;
  const lastSignInMs = lastSignInAt ? Date.parse(lastSignInAt) : Number.NaN;
  return (
    Number.isFinite(issuedAtMs) &&
    Number.isFinite(lastSignInMs) &&
    issuedAtMs <= nowMs + CLOCK_SKEW_MS &&
    lastSignInMs <= nowMs + CLOCK_SKEW_MS &&
    nowMs - issuedAtMs <= RECENT_LOGIN_WINDOW_MS &&
    nowMs - lastSignInMs <= RECENT_LOGIN_WINDOW_MS
  );
}

async function recordFailure(
  dependencies: AccountDeletionDependencies,
  state: AccountDeletionState,
  errorCode: string,
): Promise<void> {
  try {
    await dependencies.advanceRequest(
      state.userId,
      state.clientRequestId,
      state.phase,
      state.phase,
      errorCode,
    );
  } catch {
    // The primary operation error remains authoritative; a later retry can
    // safely rediscover the persisted phase.
  }
}

const phaseRank: Record<AccountDeletionPhase, number> = {
  requested: 0,
  auth_deleted: 1,
  storage_deleting: 2,
  completed: 3,
};

async function advanceWithConcurrentRecovery(
  dependencies: AccountDeletionDependencies,
  state: AccountDeletionState,
  nextPhase: AccountDeletionPhase,
): Promise<AccountDeletionState> {
  try {
    return await dependencies.advanceRequest(
      state.userId,
      state.clientRequestId,
      state.phase,
      nextPhase,
      null,
    );
  } catch (transitionError) {
    try {
      const current = await dependencies.getRequest(state.clientRequestId);
      if (
        current?.userId === state.userId &&
        phaseRank[current.phase] >= phaseRank[nextPhase]
      ) {
        return current;
      }
    } catch {
      // Preserve the transition error and map it to the phase-specific DB code.
    }
    throw transitionError;
  }
}

function completedResponse(
  state: AccountDeletionState,
  idempotent: boolean,
): Response {
  return jsonResponse(200, {
    client_request_id: state.clientRequestId,
    deleted: true,
    idempotent,
    phase: "completed",
  });
}

export function createDeleteAccountHandler(
  dependencies: AccountDeletionDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return errorResponse(
        405,
        "METHOD_NOT_ALLOWED",
        "Yalnızca POST desteklenir.",
      );
    }

    let payload: unknown;
    try {
      payload = await readBoundedJsonBody(request);
    } catch (error) {
      if (error instanceof RequestBodyError) {
        return errorResponse(error.status, error.code, error.message);
      }
      return errorResponse(400, "INVALID_JSON_BODY", "JSON gövdesi geçersiz.");
    }

    const clientRequestId = parseClientRequestId(payload);
    if (!clientRequestId) {
      return errorResponse(
        400,
        "INVALID_CLIENT_REQUEST_ID",
        "client_request_id UUID v4 olmalıdır.",
      );
    }

    const token = bearerToken(request);
    if (!token) {
      return errorResponse(401, "AUTH_REQUIRED", "Oturum gerekli.");
    }

    let claims: VerifiedTokenClaims;
    try {
      claims = await dependencies.verifyToken(token);
    } catch {
      return errorResponse(401, "TOKEN_INVALID", "Oturum doğrulanamadı.");
    }
    if (
      !UUID_PATTERN.test(claims.sub) ||
      !Number.isFinite(claims.iat) ||
      !Number.isInteger(claims.iat)
    ) {
      return errorResponse(401, "TOKEN_INVALID", "Oturum doğrulanamadı.");
    }
    const userId = claims.sub.toLowerCase();

    let state: AccountDeletionState | null;
    try {
      state = await dependencies.getRequest(clientRequestId);
    } catch {
      return errorResponse(
        502,
        "DELETION_STATE_READ_FAILED",
        "Hesap silme durumu okunamadı.",
      );
    }

    if (state && state.userId.toLowerCase() !== userId) {
      return errorResponse(
        403,
        "REQUEST_OWNER_MISMATCH",
        "Bu hesap silme isteği farklı bir hesaba aittir.",
      );
    }
    if (state?.phase === "completed") return completedResponse(state, true);

    let authState: AccountDeletionAuthState | null = null;
    if (!state) {
      try {
        authState = await dependencies.getAuthState(userId);
      } catch {
        return errorResponse(
          502,
          "AUTH_STATE_READ_FAILED",
          "Hesap durumu doğrulanamadı.",
        );
      }
      if (!authState.exists) {
        return errorResponse(
          401,
          "AUTH_USER_NOT_FOUND",
          "Oturum doğrulanamadı.",
        );
      }
      if (
        !recentLoginIsValid(claims, authState.lastSignInAt, dependencies.now())
      ) {
        return errorResponse(
          403,
          "RECENT_LOGIN_REQUIRED",
          "Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.",
        );
      }
      try {
        state = await dependencies.beginRequest(userId, clientRequestId);
      } catch {
        return errorResponse(
          502,
          "DELETION_STATE_CREATE_FAILED",
          "Hesap silme isteği başlatılamadı.",
        );
      }
      if (state.userId.toLowerCase() !== userId) {
        return errorResponse(
          403,
          "REQUEST_OWNER_MISMATCH",
          "Bu hesap silme isteği farklı bir hesaba aittir.",
        );
      }
      if (state.phase === "completed") return completedResponse(state, true);
    }

    if (state.phase === "requested") {
      if (!authState) {
        try {
          authState = await dependencies.getAuthState(userId);
        } catch {
          return errorResponse(
            502,
            "AUTH_STATE_READ_FAILED",
            "Hesap durumu doğrulanamadı.",
          );
        }
      }

      if (authState.exists) {
        if (
          !recentLoginIsValid(
            claims,
            authState.lastSignInAt,
            dependencies.now(),
          )
        ) {
          return errorResponse(
            403,
            "RECENT_LOGIN_REQUIRED",
            "Güvenlik için hesabını silmeden önce yeniden giriş yapmalısın.",
          );
        }

        try {
          await dependencies.deleteAuthUser(userId);
        } catch {
          // The status check below distinguishes a failed deletion from a
          // successful deletion whose response was lost.
        }

        try {
          authState = await dependencies.getAuthState(userId);
        } catch {
          await recordFailure(
            dependencies,
            state,
            "AUTH_DELETE_STATUS_UNKNOWN",
          );
          return errorResponse(
            502,
            "AUTH_DELETE_STATUS_UNKNOWN",
            "Auth hesabının silinme durumu doğrulanamadı.",
          );
        }

        if (authState.exists) {
          await recordFailure(dependencies, state, "AUTH_DELETE_FAILED");
          return errorResponse(
            502,
            "AUTH_DELETE_FAILED",
            "Auth hesabı silinemedi; dosyalara dokunulmadı.",
          );
        }

        // A thrown Auth response with an absent user is a response-loss case,
        // not a failed deletion. The persisted request safely resumes below.
      }

      try {
        state = await advanceWithConcurrentRecovery(
          dependencies,
          state,
          "auth_deleted",
        );
      } catch {
        return errorResponse(
          502,
          "AUTH_DELETED_STATE_WRITE_FAILED",
          "Auth silme durumu kaydedilemedi; istek güvenle yeniden denenebilir.",
        );
      }
    }

    if (state.phase === "auth_deleted") {
      try {
        state = await advanceWithConcurrentRecovery(
          dependencies,
          state,
          "storage_deleting",
        );
      } catch {
        return errorResponse(
          502,
          "STORAGE_DELETING_STATE_WRITE_FAILED",
          "Dosya temizleme durumu başlatılamadı.",
        );
      }
    }

    if (state.phase === "completed") return completedResponse(state, true);
    if (state.phase !== "storage_deleting") {
      return errorResponse(
        502,
        "DELETION_STATE_INVALID",
        "Hesap silme durumu geçersiz.",
      );
    }

    let afterStoragePath: string | null = null;
    let removedCount = 0;
    while (removedCount < MAX_STORAGE_OBJECTS_PER_INVOCATION) {
      let storagePaths: string[];
      try {
        storagePaths = await dependencies.listStoragePaths(
          userId,
          clientRequestId,
          afterStoragePath,
          STORAGE_LIST_PAGE_SIZE,
        );
      } catch {
        await recordFailure(dependencies, state, "STORAGE_LIST_FAILED");
        return errorResponse(
          502,
          "STORAGE_LIST_FAILED",
          "Profil fotoğrafı yolları listelenemedi.",
        );
      }

      const invalidPage = storagePaths.length > STORAGE_LIST_PAGE_SIZE ||
        storagePaths.some(
          (path, index) =>
            typeof path !== "string" ||
            path.indexOf("/") !== userId.length ||
            path.slice(0, userId.length).toLowerCase() !== userId ||
            path <= (afterStoragePath ?? "") ||
            (index > 0 && path <= (storagePaths[index - 1] ?? "")),
        );
      if (invalidPage) {
        await recordFailure(dependencies, state, "STORAGE_LIST_INVALID");
        return errorResponse(
          502,
          "STORAGE_LIST_INVALID",
          "Profil fotoğrafı listesi güvenlik doğrulamasından geçemedi.",
        );
      }

      if (storagePaths.length === 0) break;
      for (
        let index = 0;
        index < storagePaths.length;
        index += STORAGE_REMOVE_CHUNK_SIZE
      ) {
        const chunk = storagePaths.slice(
          index,
          index + STORAGE_REMOVE_CHUNK_SIZE,
        );
        try {
          await dependencies.removeStoragePaths(chunk);
        } catch {
          await recordFailure(dependencies, state, "STORAGE_DELETE_FAILED");
          return errorResponse(
            502,
            "STORAGE_DELETE_FAILED",
            "Profil fotoğrafları silinemedi; istek güvenle yeniden denenebilir.",
          );
        }
      }

      removedCount += storagePaths.length;
      afterStoragePath = storagePaths.at(-1) ?? afterStoragePath;
    }

    if (removedCount >= MAX_STORAGE_OBJECTS_PER_INVOCATION) {
      return jsonResponse(202, {
        client_request_id: clientRequestId,
        deleted: false,
        phase: "storage_deleting",
        resumable: true,
      });
    }

    try {
      state = await advanceWithConcurrentRecovery(
        dependencies,
        state,
        "completed",
      );
    } catch {
      return errorResponse(
        502,
        "COMPLETED_STATE_WRITE_FAILED",
        "Temizlik tamamlandı ancak sonuç kaydedilemedi; istek yeniden denenebilir.",
      );
    }
    return completedResponse(state, false);
  };
}
