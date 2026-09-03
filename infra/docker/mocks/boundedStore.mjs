// Bounded idempotency store for the synthetic upstream mock.
//
// Kept in its own module so the eviction rule is unit-testable: the previous
// implementation wiped the whole store with `clear()` once it reached the cap,
// which meant a request whose replay arrived just after the wipe was answered
// as a first delivery. That made the k6 load profile fail its "replay deduped"
// check roughly twice per 12 000 iterations — a real gate failure that only a
// long run could surface.
//
// `Map` preserves insertion order, so evicting from the front bounds memory
// while guaranteeing that a key written moments ago is still remembered.

export const maxRememberedKeys = 10_000;

export function rememberBounded(map, key, value, limit = maxRememberedKeys) {
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  return value;
}
