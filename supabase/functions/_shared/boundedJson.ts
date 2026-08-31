export class BoundedJsonError extends Error {
  constructor(
    readonly status: 400 | 413 | 415 | 502,
    message: string,
  ) {
    super(message);
    this.name = "BoundedJsonError";
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  contentLengthHeader: string | null,
  maxBytes: number,
  tooLargeStatus: 413 | 502,
): Promise<string> {
  const declaredLength = contentLengthHeader === null
    ? null
    : Number(contentLengthHeader);
  if (
    declaredLength !== null &&
    (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
  ) {
    throw new BoundedJsonError(tooLargeStatus, "Geçersiz Content-Length.");
  }
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new BoundedJsonError(tooLargeStatus, "JSON gövdesi çok büyük.");
  }
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("JSON body limit exceeded").catch(() => undefined);
        throw new BoundedJsonError(tooLargeStatus, "JSON gövdesi çok büyük.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BoundedJsonError(
      tooLargeStatus === 413 ? 400 : 502,
      "JSON UTF-8 olarak çözümlenemedi.",
    );
  }
}

function parseJson(text: string, invalidStatus: 400 | 502): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BoundedJsonError(invalidStatus, "Geçersiz JSON gövdesi.");
  }
}

export async function readBoundedJsonRequest(
  request: Request,
  maxBytes: number,
): Promise<{ rawBody: string; value: unknown }> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new BoundedJsonError(415, "Content-Type application/json olmalıdır.");
  }
  const rawBody = await readBoundedText(
    request.body,
    request.headers.get("content-length"),
    maxBytes,
    413,
  );
  return { rawBody, value: parseJson(rawBody, 400) };
}

export async function readBoundedJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new BoundedJsonError(502, "Uzak servis JSON döndürmedi.");
  }
  const rawBody = await readBoundedText(
    response.body,
    response.headers.get("content-length"),
    maxBytes,
    502,
  );
  return parseJson(rawBody, 502);
}
