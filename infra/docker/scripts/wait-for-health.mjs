const [url, timeoutValue = "120000"] = process.argv.slice(2);
const timeoutMs = Number.parseInt(timeoutValue, 10);
if (!url || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//u.test(url)) {
  throw new Error("Health URL must be an explicit loopback HTTP endpoint");
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
  throw new Error("Health timeout must be between 1000 and 300000 ms");
}

const deadline = Date.now() + timeoutMs;
let lastError = "not attempted";
while (Date.now() < deadline) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    if (response.ok) {
      clearTimeout(timeout);
      console.log(JSON.stringify({ event: "health_ready", url, status: response.status }));
      process.exit(0);
    }
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.name : "unknown";
  } finally {
    clearTimeout(timeout);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
throw new Error(`Health check timed out: ${lastError}`);
