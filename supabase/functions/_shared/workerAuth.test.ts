import { constantTimeEqual, isAuthorizedWorker } from "./workerAuth.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("constantTimeEqual aynı secret için true, farklı uzunluk ve içerik için false döner", () => {
  assert(constantTimeEqual("same-secret", "same-secret"), "same secret");
  assert(!constantTimeEqual("same-secret", "same-secret-extra"), "length");
  assert(!constantTimeEqual("same-secret", "same-secreu"), "content");
});

Deno.test("worker auth eksik header ve 32 karakterden kısa sunucu secret'ini reddeder", () => {
  const missing = new Request("https://worker.test");
  const presented = new Request("https://worker.test", {
    headers: { "x-push-worker-secret": "short" },
  });
  assert(!isAuthorizedWorker(missing, "a".repeat(32)), "missing header");
  assert(!isAuthorizedWorker(presented, "short"), "short configured secret");
});

Deno.test("worker auth yalnızca güncel secret'in birebir eşleşmesini kabul eder", () => {
  const activeSecret = "a".repeat(32);
  const active = new Request("https://worker.test", {
    headers: { "x-push-worker-secret": activeSecret },
  });
  const revoked = new Request("https://worker.test", {
    headers: { "x-push-worker-secret": "r".repeat(32) },
  });
  assert(isAuthorizedWorker(active, activeSecret), "active secret");
  assert(!isAuthorizedWorker(revoked, activeSecret), "revoked secret");
});
