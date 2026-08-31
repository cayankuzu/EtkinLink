export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export const MAX_WORKER_CLOCK_SKEW_SECONDS = 300;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/i;

export type WorkerAuthorization = {
  nonce: string;
  scope: string;
  timestamp: number;
};

function canonicalWorkerMessage(
  timestamp: number,
  nonce: string,
  scope: string,
  rawBody: string,
): string {
  return `${timestamp}\n${nonce}\n${scope}\n${rawBody}`;
}

export async function createWorkerSignature(
  workerSecret: string,
  timestamp: number,
  nonce: string,
  scope: string,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(workerSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalWorkerMessage(timestamp, nonce, scope, rawBody)),
  );
  const hex = Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `v1=${hex}`;
}

export async function authorizeWorkerRequest(
  request: Request,
  workerSecret: string,
  scope: string,
  rawBody: string,
  nowMs = Date.now(),
): Promise<WorkerAuthorization | null> {
  if (workerSecret.length < 32 || !/^[a-z0-9-]{1,64}$/.test(scope)) {
    return null;
  }

  const timestampHeader = request.headers.get("x-push-worker-timestamp") ?? "";
  const nonce = request.headers.get("x-push-worker-nonce") ?? "";
  const signatureHeader = request.headers.get("x-push-worker-signature") ?? "";
  if (!/^\d{10}$/.test(timestampHeader) || !UUID_PATTERN.test(nonce)) {
    return null;
  }
  const timestamp = Number(timestampHeader);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > MAX_WORKER_CLOCK_SKEW_SECONDS
  ) {
    return null;
  }
  const signatureMatch = SIGNATURE_PATTERN.exec(signatureHeader);
  if (!signatureMatch) return null;

  const expected = await createWorkerSignature(
    workerSecret,
    timestamp,
    nonce.toLowerCase(),
    scope,
    rawBody,
  );
  if (!constantTimeEqual(signatureHeader.toLowerCase(), expected)) return null;

  return { nonce: nonce.toLowerCase(), scope, timestamp };
}
