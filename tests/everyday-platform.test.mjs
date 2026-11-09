import test from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceStore,
  deriveVaultKey,
  seal,
  unseal,
} from "../app/everyday/evidence.js";
import {
  MODEL_REGISTRY,
  canonicalPack,
  verifyPack,
  verifyModel,
  ModelPackStore,
} from "../app/everyday/model-registry.js";
import { FEATURES } from "../app/everyday/contracts.js";

const record = (module = "nutrition", timestamp) => ({
  module,
  value: { note: "private meal details" },
  units: "entry",
  source: "user",
  consent_scope: module,
  model_id: "manual-entry",
  model_version: "1",
  correction_status: "confirmed",
  ...(timestamp ? { timestamp } : {}),
});
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

/** Minimal transactional test double: staged writes commit together, aborts discard them.
 * This checks our queue and atomic transaction behavior, not browser quota or crash durability.
 */
function fakeIndexedDB() {
  const maps = new Map(),
    control = { failWrite: false, hold: null };
  let version = 0;
  const db = {
    objectStoreNames: { contains: (name) => maps.has(name) },
    createObjectStore(name) {
      maps.set(name, new Map());
    },
    close() {},
    transaction(names, mode) {
      const selected = Array.isArray(names) ? names : [names];
      const staged = new Map(
        selected.map((name) => [
          name,
          new Map(
            [...maps.get(name)].map(([key, value]) => [
              key,
              structuredClone(value),
            ]),
          ),
        ]),
      );
      let active = true,
        pending = 0,
        completion;
      const tx = {
        abort() {
          if (!active) throw Error("Inactive transaction");
          active = false;
          clearImmediate(completion);
          setImmediate(() => tx.onabort?.());
        },
        objectStore(name) {
          const request = (method, ...args) => {
            if (!active) throw Error("Inactive transaction");
            clearImmediate(completion);
            const req = {};
            pending++;
            setImmediate(async () => {
              if (!active) return;
              if (
                control.hold?.store === name &&
                control.hold.method === method
              ) {
                const hold = control.hold;
                control.hold = null;
                hold.entered.resolve();
                await hold.release.promise;
              }
              if (!active) return;
              try {
                const map = staged.get(name);
                if (
                  control.failWrite &&
                  ["put", "delete", "clear"].includes(method)
                ) {
                  control.failWrite = false;
                  throw Error("Quota simulated");
                }
                if (method === "get")
                  req.result = structuredClone(map.get(args[0]));
                else if (method === "getAll")
                  req.result = structuredClone([...map.values()]);
                else if (method === "put") {
                  const key = name === "records" ? args[0].id : args[1];
                  map.set(key, structuredClone(args[0]));
                  req.result = key;
                } else if (method === "delete") map.delete(args[0]);
                else if (method === "clear") map.clear();
                req.onsuccess?.();
              } catch {
                tx.abort();
                return;
              }
              pending--;
              if (!pending && active)
                completion = setImmediate(() => {
                  if (!active || pending) return;
                  active = false;
                  if (mode === "readwrite")
                    for (const [name, map] of staged) maps.set(name, map);
                  tx.oncomplete?.();
                });
            });
            return req;
          };
          return Object.fromEntries(
            ["get", "getAll", "put", "delete", "clear"].map((method) => [
              method,
              (...args) => request(method, ...args),
            ]),
          );
        },
      };
      return tx;
    },
  };
  return {
    maps,
    control,
    indexedDB: {
      open() {
        const req = {};
        setImmediate(() => {
          req.result = db;
          if (!version) {
            version = 1;
            req.onupgradeneeded?.();
          }
          req.onsuccess?.();
        });
        return req;
      },
    },
  };
}
function globals(values) {
  const saved = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  return () => {
    for (const [key, descriptor] of saved)
      descriptor
        ? Object.defineProperty(globalThis, key, descriptor)
        : delete globalThis[key];
  };
}

test("encrypted evidence authenticates content, rejects wrong keys and supports large Bangla values", async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveVaultKey("a long test passphrase", salt);
  const wrong = await deriveVaultKey("a different passphrase", salt);
  const value = { text: "বাংলা".repeat(15000) };
  const encrypted = await seal(value, key),
    another = await seal(value, key);
  assert.notEqual(encrypted.iv, another.iv);
  assert.deepEqual(await unseal(encrypted, key), value);
  await assert.rejects(unseal(encrypted, wrong));
  const tampered = {
    ...encrypted,
    cipher:
      (encrypted.cipher[0] === "A" ? "B" : "A") + encrypted.cipher.slice(1),
  };
  await assert.rejects(unseal(tampered, key));
  await assert.rejects(deriveVaultKey("short", salt), /passphrase/);
  await assert.rejects(
    deriveVaultKey("valid passphrase", new Uint8Array(1)),
    /salt/,
  );
});

test("session writes serialize consent withdrawal, defensive copies and delete with unavailable IndexedDB", async () => {
  const restore = globals({ indexedDB: undefined });
  try {
    const store = new EvidenceStore();
    const saved = await store.add(record());
    saved.value.note = "mutated";
    const listed = await store.list();
    assert.equal(listed[0].value.note, "private meal details");
    listed[0].value.note = "mutated again";
    assert.equal(
      (await store.export()).records[0].value.note,
      "private meal details",
    );
    const first = store.add(record()),
      revoked = store.setConsent("nutrition", false),
      rejected = store.add(record());
    const results = await Promise.allSettled([first, revoked, rejected]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "fulfilled");
    assert.equal(results[2].status, "rejected");
    assert.match(results[2].reason.message, /paused/);
    assert.equal((await store.list()).length, 0);
    await store.add(record("move"));
    await store.deleteAll();
    assert.equal((await store.list()).length, 0);
    const pending = store.add(record("move")),
      cancellation = assert.rejects(pending, /cancelled/);
    store.lock();
    await cancellation;
    assert.equal(store.key, null);
    assert.equal((await store.list()).length, 0);
    await store.add(record("move"));
    assert.equal((await store.list()).length, 1);
    await assert.rejects(store.setConsent("nutrition", "false"), /boolean/);
  } finally {
    restore();
  }
});

test("vault migration, lock, wrong passphrase, encrypted preferences, retention and removal work atomically", async () => {
  const fake = fakeIndexedDB(),
    restore = globals({ indexedDB: fake.indexedDB });
  try {
    const store = new EvidenceStore();
    await store.add(
      record("nutrition", new Date(Date.now() - 5 * 86400000).toISOString()),
    );
    await store.add(record("move"));
    await store.create("a long test passphrase");
    assert.equal(await store.vaultExists(), true);
    const raw = JSON.stringify([...fake.maps.get("records").values()]);
    assert.ok(!raw.includes("private meal details"));
    assert.ok(fake.maps.get("settings").get("vault").preferences.cipher);
    assert.equal(fake.maps.get("settings").get("vault").consent, undefined);
    store.lock();
    await assert.rejects(store.unlock("incorrect passphrase"), /passphrase/);
    assert.equal(store.key, null);
    assert.equal(store.records.length, 0);
    await store.unlock("a long test passphrase");
    assert.equal((await store.list()).length, 2);
    store.retentionDays = 1;
    await store.saveSettings();
    assert.equal((await store.list()).length, 1);
    assert.equal(fake.maps.get("records").size, 1);
    await store.add(record("nutrition"));
    await store.setConsent("nutrition", false);
    assert.equal((await store.list("nutrition")).length, 0);
    assert.equal(fake.maps.get("records").size, 1);
    store.lock();
    await store.unlock("a long test passphrase");
    assert.equal(store.retentionDays, 1);
    assert.equal(store.consent.nutrition, false);
    await assert.rejects(store.add(record()), /paused/);
    const contender = new EvidenceStore();
    await assert.rejects(
      contender.create("some other passphrase"),
      /already exists/,
    );
    assert.equal(fake.maps.get("records").size, 1);
    store.lock();
    await assert.rejects(store.setConsent("move", false), /Unlock the vault/);
    await store.deleteAll();
    assert.equal(fake.maps.get("records").size, 0);
    assert.equal(await store.vaultExists(), false);
  } finally {
    restore();
  }
});

test("locking during encryption or unlock cannot repopulate plaintext or finish a queued write", async () => {
  const fake = fakeIndexedDB(),
    restore = globals({ indexedDB: fake.indexedDB });
  try {
    const store = new EvidenceStore();
    await store.create("a long test passphrase");
    const gate = defer(),
      entered = defer(),
      original = store._persist.bind(store);
    store._persist = async (...args) => {
      entered.resolve();
      await gate.promise;
      return original(...args);
    };
    const writing = store.add(record()),
      rejection = assert.rejects(writing, /cancelled/);
    await entered.promise;
    store.lock();
    gate.resolve();
    await rejection;
    assert.equal(store.records.length, 0);
    assert.equal(fake.maps.get("records").size, 0);
    await store.unlock("a long test passphrase");
    store._persist = original;
    await store.add(record());
    store.lock();
    const hold = {
      store: "records",
      method: "getAll",
      entered: defer(),
      release: defer(),
    };
    fake.control.hold = hold;
    const unlocking = store.unlock("a long test passphrase"),
      stopped = assert.rejects(unlocking, /cancelled/);
    await hold.entered.promise;
    store.lock();
    hold.release.resolve();
    await stopped;
    assert.equal(store.key, null);
    assert.equal(store.persistent, false);
    assert.equal(store.records.length, 0);
    await store.unlock("a long test passphrase");
    assert.equal((await store.list()).length, 1);
  } finally {
    restore();
  }
});

test("storage failure leaves consent and records consistent, queue recovers, and delete failure is explicit", async () => {
  const fake = fakeIndexedDB(),
    restore = globals({ indexedDB: fake.indexedDB });
  try {
    const store = new EvidenceStore();
    await store.create("a long test passphrase");
    await store.add(record());
    fake.control.failWrite = true;
    await assert.rejects(
      store.setConsent("nutrition", false),
      /storage operation failed/,
    );
    assert.equal(store.consent.nutrition, true);
    assert.equal(store.records.length, 1);
    assert.equal(fake.maps.get("records").size, 1);
    fake.control.failWrite = true;
    await assert.rejects(store.add(record("move")), /storage operation failed/);
    assert.equal(store.records.length, 1);
    await store.add(record("move"));
    assert.equal(store.records.length, 2);
    globalThis.indexedDB = undefined;
    await assert.rejects(store.deleteAll(), /could not be deleted/);
    assert.equal(store.records.length, 0);
    assert.equal(store.key, null);
    globalThis.indexedDB = fake.indexedDB;
    await store.deleteAll();
    assert.equal(await store.vaultExists(), false);
  } finally {
    restore();
  }
});

test("tampered encrypted policy and invalid retention fail closed", async () => {
  const fake = fakeIndexedDB(),
    restore = globals({ indexedDB: fake.indexedDB });
  try {
    const store = new EvidenceStore();
    await store.create("a long test passphrase");
    store.retentionDays = 0;
    await assert.rejects(store.saveSettings(), /Retention/);
    store.retentionDays = 30;
    store.lock();
    const meta = fake.maps.get("settings").get("vault");
    meta.preferences.cipher =
      (meta.preferences.cipher[0] === "A" ? "B" : "A") +
      meta.preferences.cipher.slice(1);
    await assert.rejects(store.unlock("a long test passphrase"), /damaged/);
    assert.equal(store.key, null);
    assert.equal(store.records.length, 0);
  } finally {
    restore();
  }
});

test("a stale vault instance cannot revive records after consent withdrawal or another instance deletes the vault", async () => {
  const fake = fakeIndexedDB(),
    restore = globals({ indexedDB: fake.indexedDB });
  try {
    const oldTab = new EvidenceStore();
    await oldTab.create("a long test passphrase");
    await oldTab.add(record());
    const activeTab = new EvidenceStore();
    await activeTab.unlock("a long test passphrase");
    await activeTab.setConsent("nutrition", false);
    await assert.rejects(oldTab.add(record()), /changed in another tab/);
    assert.equal(fake.maps.get("records").size, 0);
    await oldTab.deleteAll();
    await assert.rejects(
      activeTab.add(record("move")),
      /changed in another tab/,
    );
    assert.equal(fake.maps.get("records").size, 0);
    assert.equal(fake.maps.get("settings").size, 0);
  } finally {
    restore();
  }
});

async function signing() {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const sign = async (pack) => ({
    ...pack,
    signature: Buffer.from(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        keys.privateKey,
        new TextEncoder().encode(canonicalPack(pack)),
      ),
    ).toString("base64"),
  });
  return { publicKey, sign };
}
async function asset(
  bytes = new Uint8Array([1, 2, 3]),
  url = "/models/example.task",
) {
  return {
    url,
    bytes: bytes.byteLength,
    sha256: Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
      "hex",
    ),
  };
}
function fakeCaches() {
  const maps = new Map();
  return {
    maps,
    caches: {
      async keys() {
        return [...maps.keys()];
      },
      async delete(name) {
        return maps.delete(name);
      },
      async open(name) {
        if (!maps.has(name)) maps.set(name, new Map());
        const map = maps.get(name);
        return {
          async put(key, response) {
            if (!response) throw Error("Missing response");
            map.set(String(key), response.clone());
          },
          async match(key) {
            return map.get(String(key))?.clone();
          },
        };
      },
    },
  };
}
function fakeStorage() {
  const map = new Map();
  let fail = null;
  return {
    map,
    failOn(key) {
      fail = key;
    },
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem(key, value) {
        if (fail === key) {
          fail = null;
          throw Error("Storage quota simulated");
        }
        map.set(key, String(value));
      },
      removeItem: (key) => map.delete(key),
    },
  };
}

test("signed packs require a real public trust key and validate all identity, path, size and version fields", async () => {
  const { publicKey, sign } = await signing(),
    ref = await asset();
  const pack = await sign({ id: "food-test", version: "1.0.0", assets: [ref] });
  assert.equal(await verifyPack(pack, publicKey), true);
  await assert.rejects(verifyPack(pack, null), /trust key/);
  await assert.rejects(
    verifyPack({ ...pack, version: "2.0.0" }, publicKey),
    /signature/,
  );
  const other = await signing();
  await assert.rejects(verifyPack(pack, other.publicKey), /signature/);
  for (const id of ["", "../food", "food--test", "UPPER", "x".repeat(65)])
    assert.throws(() => canonicalPack({ ...pack, id }), /ID/);
  for (const version of ["", "../1", "a/b", "1..2", "x".repeat(65)])
    assert.throws(() => canonicalPack({ ...pack, version }), /version/);
  for (const url of [
    "//evil.test/model.task",
    "/models/../a.task",
    "/models/%2e%2e/a.task",
    "/models/a.task?x=1",
    "https://evil.test/a.task",
    "/models/a.json",
  ]) {
    assert.throws(
      () => canonicalPack({ ...pack, assets: [{ ...ref, url }] }),
      /asset/,
    );
  }
  assert.throws(() => canonicalPack({ ...pack, assets: [] }), /assets/);
  assert.throws(() => canonicalPack({ ...pack, assets: [ref, ref] }), /asset/);
  assert.throws(
    () => canonicalPack({ ...pack, assets: [{ ...ref, bytes: 0 }] }),
    /asset/,
  );
  assert.throws(
    () =>
      canonicalPack({ ...pack, assets: [{ ...ref, sha256: "not-a-hash" }] }),
    /asset/,
  );
  assert.throws(
    () => canonicalPack({ ...pack, extraUnsigned: "value" }),
    /field/,
  );
  assert.equal(FEATURES.signedReleasePacks, false);
  for (const installed of Object.values(MODEL_REGISTRY))
    assert.match(installed.sha256, /^[a-f0-9]{64}$/);
});

test("pack install verifies bytes before activation, preserves prior release on corrupt update and verifies rollback", async () => {
  const cache = fakeCaches(),
    storage = fakeStorage(),
    { publicKey, sign } = await signing();
  let download = new Uint8Array([1, 2, 3]);
  const restore = globals({
    caches: cache.caches,
    localStorage: storage.storage,
    fetch: async () => new Response(download),
  });
  try {
    const store = new ModelPackStore(publicKey),
      ref = await asset();
    const first = await sign({ id: "food-test", version: "1", assets: [ref] });
    const name1 = await store.install(first);
    assert.equal(storage.map.get("asha_pack_food-test"), name1);
    assert.equal(await store.install(first), name1); // Idempotent, no self-rollback pointer.
    const second = await sign({
      id: "food-test",
      version: "2",
      previous: "1",
      assets: [ref],
    });
    download = new Uint8Array([3, 2, 1]);
    await assert.rejects(store.install(second), /integrity/);
    assert.equal(storage.map.get("asha_pack_food-test"), name1);
    assert.ok(![...cache.maps.keys()].some((name) => name.includes("staging")));
    download = new Uint8Array([1, 2, 3]);
    const name2 = await store.install(second);
    assert.equal(storage.map.get("asha_pack_previous_food-test"), name1);
    assert.equal(await store.rollback("food-test"), name1);
    assert.equal(await store.rollback("food-test"), name2);
    const cachedFirst = await cache.caches.open(name1);
    await cachedFirst.put(ref.url, new Response(new Uint8Array([9, 9, 9])));
    await assert.rejects(store.rollback("food-test"), /integrity/);
    assert.equal(storage.map.get("asha_pack_food-test"), name2);
    await store.evict("food-test");
    assert.equal(cache.maps.size, 0);
    assert.equal(storage.map.size, 0);
  } finally {
    restore();
  }
});

test("immutable versions, mismatched release chain, oversized streams and pointer write failure are rejected safely", async () => {
  const cache = fakeCaches(),
    storage = fakeStorage(),
    { publicKey, sign } = await signing();
  let download = new Uint8Array([1, 2, 3]);
  const restore = globals({
    caches: cache.caches,
    localStorage: storage.storage,
    fetch: async () => new Response(download),
  });
  try {
    const store = new ModelPackStore(publicKey),
      ref = await asset();
    const first = await sign({ id: "pose-test", version: "1", assets: [ref] });
    const name1 = await store.install(first);
    const changed = await sign({
      ...first,
      assets: [await asset(new Uint8Array([4, 5, 6]))],
    });
    await assert.rejects(store.install(changed), /immutable/);
    await assert.rejects(
      store.install(
        await sign({
          id: "pose-test",
          version: "2",
          previous: "wrong",
          assets: [ref],
        }),
      ),
      /previous version/,
    );
    const second = await sign({
      id: "pose-test",
      version: "2",
      previous: "1",
      assets: [ref],
    });
    download = new Uint8Array([1, 2, 3, 4]);
    await assert.rejects(store.install(second), /exceeded/);
    assert.equal(storage.map.get("asha_pack_pose-test"), name1);
    download = new Uint8Array([1, 2, 3]);
    storage.failOn("asha_pack_pose-test");
    await assert.rejects(store.install(second), /quota/);
    assert.equal(storage.map.get("asha_pack_pose-test"), name1);
    assert.ok(cache.maps.has(name1));
    assert.equal(await store.install(second), "asha-pack-pose-test--2");
    await assert.rejects(store.rollback("../pose"), /ID/);
    await assert.rejects(verifyModel(new Uint8Array([1, 2]), ref), /size/);
  } finally {
    restore();
  }
});
