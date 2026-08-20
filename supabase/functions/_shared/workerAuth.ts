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

export function isAuthorizedWorker(
  request: Request,
  workerSecret: string,
): boolean {
  const presentedSecret = request.headers.get("x-push-worker-secret") ?? "";
  return workerSecret.length >= 32 &&
    constantTimeEqual(presentedSecret, workerSecret);
}
