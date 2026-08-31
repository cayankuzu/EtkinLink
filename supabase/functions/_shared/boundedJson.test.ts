import {
  BoundedJsonError,
  readBoundedJsonRequest,
  readBoundedJsonResponse,
} from "./boundedJson.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function expectStatus(
  action: () => Promise<unknown>,
  expectedStatus: number,
): Promise<void> {
  try {
    await action();
    throw new Error("Expected bounded JSON error.");
  } catch (error) {
    assert(error instanceof BoundedJsonError, "error type");
    assert(error.status === expectedStatus, `status ${error.status}`);
  }
}

Deno.test("bounded request JSON requires media type and valid JSON", async () => {
  await expectStatus(
    () =>
      readBoundedJsonRequest(
        new Request("https://worker.test", { method: "POST", body: "{}" }),
        100,
      ),
    415,
  );
  await expectStatus(
    () =>
      readBoundedJsonRequest(
        new Request("https://worker.test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{broken",
        }),
        100,
      ),
    400,
  );
});

Deno.test("bounded request JSON enforces streamed bytes without Content-Length", async () => {
  const request = new Request("https://worker.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(200)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    }),
  });
  await expectStatus(() => readBoundedJsonRequest(request, 64), 413);
});

Deno.test("bounded response JSON rejects non-JSON and oversized streams", async () => {
  await expectStatus(
    () => readBoundedJsonResponse(new Response("{}"), 100),
    502,
  );
  const response = new Response(JSON.stringify({ value: "x".repeat(200) }), {
    headers: { "content-type": "application/json" },
  });
  await expectStatus(() => readBoundedJsonResponse(response, 64), 502);
});

Deno.test("bounded request returns the exact signed bytes and parsed value", async () => {
  const rawBody = '{"drain": true}';
  const result = await readBoundedJsonRequest(
    new Request("https://worker.test", {
      method: "POST",
      headers: { "content-type": "application/problem+json" },
      body: rawBody,
    }),
    100,
  );
  assert(result.rawBody === rawBody, "raw body");
  assert((result.value as { drain?: unknown }).drain === true, "parsed body");
});
