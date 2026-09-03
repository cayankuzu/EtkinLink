import assert from "node:assert/strict";
import { test } from "node:test";

import { maxRememberedKeys, rememberBounded } from "./boundedStore.mjs";

test("kaydedilen anahtar hemen geri okunur", () => {
  const store = new Map();
  rememberBounded(store, "message-1", { id: "a" });
  assert.deepEqual(store.get("message-1"), { id: "a" });
});

test("sınıra ulaşınca mağazayı tamamen silmez", () => {
  const store = new Map();
  for (let index = 0; index < 5; index += 1) {
    rememberBounded(store, `key-${index}`, index, 3);
  }
  assert.equal(store.size, 3);
  // The three most recent keys survive; only the oldest two were evicted.
  assert.deepEqual([...store.keys()], ["key-2", "key-3", "key-4"]);
});

test("az önce yazılan anahtar tahliye edilmez", () => {
  const store = new Map();
  const limit = 3;
  for (let index = 0; index < 50; index += 1) {
    const key = `key-${index}`;
    rememberBounded(store, key, index, limit);
    // This is the load profile's pattern: the replay follows its original
    // immediately, so the key must still be remembered.
    assert.equal(store.has(key), true, `${key} tahliye edilmemeliydi`);
  }
});

test("mağaza sınırın üstüne çıkmaz", () => {
  const store = new Map();
  for (let index = 0; index < 2_000; index += 1) {
    rememberBounded(store, `key-${index}`, index, 100);
    assert.ok(store.size <= 100);
  }
  assert.equal(store.size, 100);
});

test("aynı anahtarın yeniden yazılması mağazayı büyütmez", () => {
  const store = new Map();
  rememberBounded(store, "key", 1, 10);
  rememberBounded(store, "key", 2, 10);
  assert.equal(store.size, 1);
  assert.equal(store.get("key"), 2);
});

test("varsayılan sınır mock sözleşmesiyle aynıdır", () => {
  assert.equal(maxRememberedKeys, 10_000);
});
