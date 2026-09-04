/**
 * Bounds an incoming `etkinlink://` deep link before React Navigation parses it.
 *
 * React Navigation's default `getStateFromPath` hands the query string to
 * `query-string`, which decodes it with `decode-uri-component`. Every published
 * version of that package is affected by GHSA-vcc3-ghjq-m6fr (denial of service
 * via exponential decoding of malformed percent-encoded input) and no fixed
 * release exists, so the dependency cannot be upgraded out of the problem. Any
 * app or web page on the device can open an `etkinlink://` URL, so an
 * attacker-controlled query string would reach that decoder and hang the JS
 * thread.
 *
 * The linking config declares exactly one route (`auth/reset-password`) and it
 * takes no query parameters: the Supabase PKCE `code` is read from the raw URL
 * by `exchangeAuthCode`, independently of navigation linking. So the query
 * string is dropped rather than parsed, and the remaining path is length-bounded.
 * This removes the reachable path without changing any supported deep link.
 */

/** Longest path this app's linking config can legitimately produce. */
export const maxDeepLinkPathLength = 512;

export function sanitizeDeepLinkPath(path: string): string | undefined {
  if (typeof path !== 'string') return undefined;
  if (path.length > maxDeepLinkPathLength) return undefined;

  // Drop the query and fragment; neither feeds a supported route.
  const withoutFragment = path.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  if (withoutQuery.length === 0) return undefined;

  // A percent sequence that is not a complete `%XX` triplet is exactly the
  // malformed input the advisory is about, and no supported route contains one.
  if (/%(?![0-9a-fA-F]{2})/u.test(withoutQuery)) return undefined;

  return withoutQuery;
}
