import * as Sentry from '@sentry/react-native';
import { env } from '@shared/config/env';
import { toAppError } from '@shared/lib/errors';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type TelemetryContext = Record<string, unknown>;

const sensitiveKeyPattern =
  /authorization|cookie|email|message|password|phone|refresh|secret|session|token|username/i;
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const bearerPattern = /bearer\s+[a-z0-9._~+/=-]+/gi;
const jwtPattern = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;

let initialized = false;

function sanitizeText(value: string): string {
  return value
    .replace(emailPattern, '<email>')
    .replace(bearerPattern, 'Bearer <redacted>')
    .replace(jwtPattern, '<token>')
    .slice(0, 2_000);
}

export function sanitizeTelemetryValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value))
    return value.slice(0, 50).map(sanitizeTelemetryValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([key, nested]) => [
        key,
        sensitiveKeyPattern.test(key)
          ? '<redacted>'
          : sanitizeTelemetryValue(nested),
      ]),
  );
}

export function initializeTelemetry(): void {
  if (initialized) return;
  initialized = true;
  const version = Constants.expoConfig?.version ?? 'unknown';
  const buildNumber =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber ?? 'unknown'
      : String(Constants.expoConfig?.android?.versionCode ?? 'unknown');
  const release = `etkinlink-mobile@${version}`;
  Sentry.init({
    dsn: env.sentryDsn ?? undefined,
    enabled: !__DEV__ && Boolean(env.sentryDsn),
    environment: __DEV__ ? 'development' : 'production',
    release,
    dist: buildNumber,
    tracesSampleRate: env.sentryTracesSampleRate,
    sendDefaultPii: false,
    attachStacktrace: true,
    enableAutoSessionTracking: true,
    beforeSend: event => sanitizeTelemetryValue(event) as typeof event,
    beforeBreadcrumb: breadcrumb =>
      sanitizeTelemetryValue(breadcrumb) as typeof breadcrumb,
  });
  Sentry.setTags({
    app: 'etkinlink-mobile',
    platform: Platform.OS,
    app_version: version,
    build_number: buildNumber,
    runtime_version: String(Constants.expoConfig?.runtimeVersion ?? 'unknown'),
  });
}

export function captureAppError(
  error: unknown,
  context: TelemetryContext = {},
): void {
  const safeContext = sanitizeTelemetryValue(context) as TelemetryContext;
  const safeError =
    error instanceof Error
      ? new Error(sanitizeText(error.message))
      : new Error(sanitizeText(String(error)));
  if (error instanceof Error && error.stack) {
    safeError.stack = sanitizeText(error.stack);
  }
  const domain =
    typeof safeContext.operation === 'string'
      ? safeContext.operation
      : typeof safeContext.flow === 'string'
      ? safeContext.flow
      : typeof safeContext.queryDomain === 'string'
      ? `query.${safeContext.queryDomain}`
      : 'unknown';
  Sentry.captureException(safeError, {
    extra: safeContext,
    tags: { error_domain: sanitizeText(domain) },
  });
}

/**
 * The only sanctioned console writer in `src/`.
 *
 * A release build still forwards `console.warn` to logcat/os_log, where any
 * other process with log access can read it. Passing a raw provider error there
 * would leak the Expo push token, a signed Storage URL or a PostgREST row
 * fragment, so callers may log a fixed message plus the stable `AppError` code
 * and nothing else.
 */
export function warnRedacted(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(sanitizeText(message));
    return;
  }
  console.warn(sanitizeText(message), toAppError(error).code);
}

export function recordPerformance(
  name: string,
  durationMs: number,
  context: TelemetryContext = {},
): void {
  Sentry.addBreadcrumb({
    category: 'performance',
    level: durationMs > 2_500 ? 'warning' : 'info',
    message: sanitizeText(name),
    data: sanitizeTelemetryValue({
      durationMs: Math.round(durationMs),
      ...context,
    }) as Record<string, unknown>,
  });
}
