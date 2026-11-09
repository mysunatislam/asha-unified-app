import { MODULES, evidenceRecord } from "./contracts.js";

const encode = (bytes) => {
  const view = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < view.length; i += 16384)
    text += String.fromCharCode(...view.subarray(i, i + 16384));
  return btoa(text);
};
const decode = (text) => {
  if (
    typeof text !== "string" ||
    text.length > 1500000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(text)
  )
    throw Error("Invalid encrypted data.");
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
};
const copy = (value) => structuredClone(value);
const cancelled = () =>
  Error("Vault operation was cancelled by locking or deleting the vault.");
const defaults = () =>
  Object.fromEntries(MODULES.map((module) => [module, true]));
const vaultTag = (meta) =>
  JSON.stringify({ salt: meta.salt, check: meta.check });
const policyTag = (meta) =>
  JSON.stringify(
    meta.preferences || {
      consent: meta.consent,
      retentionDays: meta.retentionDays,
    },
  );
function retention(value) {
  if (!Number.isInteger(value) || value < 1 || value > 365)
    throw Error("Retention must be between 1 and 365 days.");
  return value;
}
function preferences(value) {
  const result = defaults();
  for (const module of MODULES) {
    if (
      value.consent?.[module] !== undefined &&
      typeof value.consent[module] !== "boolean"
    )
      throw Error("Invalid stored consent.");
    if (value.consent?.[module] !== undefined)
      result[module] = value.consent[module];
  }
  return {
    retentionDays: retention(value.retentionDays ?? 30),
    consent: result,
  };
}

export async function deriveVaultKey(passphrase, salt) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 10 ||
    passphrase.length > 1024
  )
    throw Error("Use a passphrase of 10 to 1024 characters.");
  if (!(salt instanceof Uint8Array) || salt.byteLength !== 16)
    throw Error("Invalid vault salt.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    bytes,
  );
  return { iv: encode(iv), cipher: encode(cipher) };
}
export async function unseal(value, key) {
  const iv = decode(value?.iv);
  if (iv.byteLength !== 12) throw Error("Invalid encrypted record.");
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    decode(value?.cipher),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}

function openDatabase(signal) {
  if (signal?.aborted) return Promise.reject(cancelled());
  if (!globalThis.indexedDB)
    return Promise.reject(
      Error(
        "Encrypted storage is unavailable. This session can still be used.",
      ),
    );
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("asha-everyday-v1", 1);
    req.onupgradeneeded = () => {
      for (const name of ["records", "settings"])
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(
            name,
            name === "records" ? { keyPath: "id" } : undefined,
          );
        }
    };
    req.onsuccess = () => {
      if (signal?.aborted) {
        req.result.close();
        reject(cancelled());
      } else resolve(req.result);
    };
    req.onerror = () => reject(Error("Device storage could not be opened."));
    req.onblocked = () =>
      reject(
        Error("Device storage is busy in another tab. Close it and retry."),
      );
  });
}

/** One atomic IDB transaction, with synchronous cancellation on lock. Never resolve on request success alone. */
async function transaction(names, mode, callback, signal) {
  const db = await openDatabase(signal);
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      db.close();
    };
    const abort = () => {
      failure = cancelled();
      try {
        tx?.abort();
      } catch {
        /* already completed */
      }
    };
    try {
      if (signal?.aborted) {
        db.close();
        reject(cancelled());
        return;
      }
      tx = db.transaction(names, mode);
      signal?.addEventListener("abort", abort, { once: true });
      tx.oncomplete = () => {
        cleanup();
        signal?.aborted ? reject(cancelled()) : resolve(result);
      };
      tx.onerror = tx.onabort = () => {
        cleanup();
        reject(failure || Error("Device storage operation failed."));
      };
      callback(
        tx,
        (value) => {
          result = value;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    } catch (error) {
      failure = error;
      try {
        tx?.abort();
      } catch {
        /* no active transaction */
      }
      cleanup();
      reject(error);
    }
  });
}
const read = (store, method, signal, ...args) =>
  transaction(
    store,
    "readonly",
    (tx, done) => {
      const req = tx.objectStore(store)[method](...args);
      req.onsuccess = () => done(req.result);
    },
    signal,
  );

export class EvidenceStore {
  constructor() {
    this.records = [];
    this.key = null;
    this.persistent = false;
    this.retentionDays = 30;
    this.consent = defaults();
    this._queue = Promise.resolve();
    this._generation = 0;
    this._active = null;
    this._vaultKnown = false;
    this._vaultTag = null;
    this._policyTag = null;
  }
  _enqueue(action) {
    const generation = this._generation;
    const work = async () => {
      if (generation !== this._generation) throw cancelled();
      const controller = new AbortController();
      this._active = controller;
      const check = () => {
        if (controller.signal.aborted || generation !== this._generation)
          throw cancelled();
      };
      try {
        const result = await action(controller.signal, check);
        check();
        return result;
      } finally {
        if (this._active === controller) this._active = null;
      }
    };
    const promise = this._queue.then(work);
    this._queue = promise.catch(() => {});
    return promise;
  }
  async _write(
    signal,
    callback,
    expected = { vault: this._vaultTag, policy: this._policyTag },
  ) {
    // Optimistic policy guard also protects separate tabs/instances from reviving revoked or deleted data.
    return transaction(
      ["records", "settings"],
      "readwrite",
      (tx, done, fail) => {
        const req = tx.objectStore("settings").get("vault");
        req.onsuccess = () => {
          if (
            !req.result ||
            vaultTag(req.result) !== expected.vault ||
            policyTag(req.result) !== expected.policy
          ) {
            fail(
              Error(
                "The vault changed in another tab. Lock and unlock it before saving again.",
              ),
            );
            return;
          }
          callback(tx, req.result);
        };
      },
      signal,
    );
  }
  async vaultExists() {
    return this._enqueue(async (signal, check) => {
      const value = await read("settings", "get", signal, "vault").catch(
        (error) => {
          check();
          if (this._vaultKnown) throw error;
          return null;
        },
      );
      check();
      this._vaultKnown = !!value;
      return !!value;
    });
  }
  async unlock(passphrase) {
    return this._enqueue(async (signal, check) => {
      const meta = await read("settings", "get", signal, "vault");
      check();
      if (!meta) throw Error("Create your encrypted vault first.");
      const key = await deriveVaultKey(passphrase, decode(meta.salt));
      check();
      let prefs;
      try {
        if ((await unseal(meta.check, key)) !== "asha-vault-v1") throw Error();
        // Legacy v1 preferences were plain text. New writes authenticate them with AES-GCM.
        prefs = preferences(
          meta.preferences ? await unseal(meta.preferences, key) : meta,
        );
      } catch {
        throw Error(
          "The passphrase could not unlock this vault, or its metadata was damaged.",
        );
      }
      check();
      const rows = await read("records", "getAll", signal);
      check();
      const records = [];
      for (const row of rows) {
        const record = await unseal(row, key);
        check();
        if (
          record?.id !== row.id ||
          typeof record.id !== "string" ||
          record.id.length > 100
        )
          throw Error("Encrypted record identity is invalid.");
        const validated = evidenceRecord(record);
        validated.id = record.id;
        records.push(validated);
      }
      const cutoff = Date.now() - prefs.retentionDays * 86400000;
      const expired = records.filter(
        (record) =>
          !prefs.consent[record.module] ||
          Date.parse(record.timestamp) < cutoff,
      );
      const newPreferences = await seal(prefs, key);
      check();
      const updatedMeta = {
        salt: meta.salt,
        check: meta.check,
        preferences: newPreferences,
      };
      await this._write(
        signal,
        (tx) => {
          for (const record of expired)
            tx.objectStore("records").delete(record.id);
          tx.objectStore("settings").put(updatedMeta, "vault");
        },
        { vault: vaultTag(meta), policy: policyTag(meta) },
      );
      check();
      this.key = key;
      this.persistent = true;
      this._vaultKnown = true;
      this._vaultTag = vaultTag(updatedMeta);
      this._policyTag = policyTag(updatedMeta);
      this.records = records.filter((record) => !expired.includes(record));
      this.retentionDays = prefs.retentionDays;
      this.consent = prefs.consent;
    });
  }
  async create(passphrase) {
    return this._enqueue(async (signal, check) => {
      const prefs = preferences(this);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveVaultKey(passphrase, salt);
      check();
      const meta = {
        salt: encode(salt),
        check: await seal("asha-vault-v1", key),
        preferences: await seal(prefs, key),
      };
      check();
      const cutoff = Date.now() - prefs.retentionDays * 86400000;
      const records = this.records.filter(
        (record) =>
          prefs.consent[record.module] &&
          Date.parse(record.timestamp) >= cutoff,
      );
      const sealed = [];
      for (const record of records) {
        sealed.push({ id: record.id, ...(await seal(record, key)) });
        check();
      }
      await transaction(
        ["records", "settings"],
        "readwrite",
        (tx, done, fail) => {
          const settings = tx.objectStore("settings"),
            req = settings.get("vault");
          req.onsuccess = () => {
            if (req.result) {
              fail(
                Error(
                  "An encrypted vault already exists. Unlock it or delete it first.",
                ),
              );
              return;
            }
            tx.objectStore("records").clear();
            for (const row of sealed) tx.objectStore("records").put(row);
            settings.put(meta, "vault");
          };
        },
        signal,
      );
      check();
      this.key = key;
      this.persistent = true;
      this.records = records;
      this._vaultKnown = true;
      this._vaultTag = vaultTag(meta);
      this._policyTag = policyTag(meta);
    });
  }
  async _persist(record, signal, check) {
    if (!this.persistent || !this.key) return;
    const value = { id: record.id, ...(await seal(record, this.key)) };
    check();
    await this._write(signal, (tx) => tx.objectStore("records").put(value));
    check();
  }
  async persist(input) {
    const snapshot = copy(input),
      record = evidenceRecord(snapshot);
    if (typeof snapshot.id !== "string" || snapshot.id.length > 100)
      throw Error("A saved record identity is required.");
    record.id = snapshot.id;
    return this._enqueue((signal, check) => {
      if (!this.consent[record.module])
        throw Error("Saving this module is paused in Privacy.");
      return this._persist(record, signal, check);
    });
  }
  async add(input) {
    const record = evidenceRecord(copy(input));
    return this._enqueue(async (signal, check) => {
      if (!this.consent[record.module])
        throw Error("Saving this module is paused in Privacy.");
      if (
        Date.parse(record.timestamp) <
        Date.now() - retention(this.retentionDays) * 86400000
      )
        throw Error("This record is older than the retention period.");
      await this._prune(signal, check);
      await this._persist(record, signal, check);
      check();
      this.records.unshift(record);
      return copy(record);
    });
  }
  async list(module) {
    if (module && !MODULES.includes(module)) throw Error("Unknown module.");
    return this._enqueue(async (signal, check) => {
      await this._prune(signal, check);
      return copy(
        this.records
          .filter((record) => !module || record.module === module)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
      );
    });
  }
  async remove(id) {
    return this._enqueue(async (signal, check) => {
      if (this.persistent)
        await this._write(signal, (tx) => tx.objectStore("records").delete(id));
      check();
      this.records = this.records.filter((record) => record.id !== id);
    });
  }
  async _prune(signal, check) {
    const cutoff = Date.now() - retention(this.retentionDays) * 86400000;
    const expired = this.records.filter(
      (record) =>
        !this.consent[record.module] || Date.parse(record.timestamp) < cutoff,
    );
    if (!expired.length) return;
    if (this.persistent)
      await this._write(signal, (tx) => {
        for (const record of expired)
          tx.objectStore("records").delete(record.id);
      });
    check();
    this.records = this.records.filter((record) => !expired.includes(record));
  }
  async prune() {
    return this._enqueue((signal, check) => this._prune(signal, check));
  }
  async setConsent(module, allowed) {
    if (!MODULES.includes(module) || typeof allowed !== "boolean")
      throw Error("Choose a known consent scope and boolean value.");
    return this._enqueue(async (signal, check) => {
      if (!allowed && !this.key) {
        const exists = await read("settings", "get", signal, "vault").catch(
          (error) => {
            check();
            if (this._vaultKnown) throw error;
            return null;
          },
        );
        check();
        if (exists) {
          this._vaultKnown = true;
          throw Error(
            "Unlock the vault to remove this module’s saved records, or delete the whole vault.",
          );
        }
      }
      const consent = { ...this.consent, [module]: allowed };
      if (this.persistent) {
        const meta = await read("settings", "get", signal, "vault");
        check();
        if (!meta) throw Error("Vault metadata is missing. Lock and retry.");
        const encrypted = await seal(
          preferences({ consent, retentionDays: this.retentionDays }),
          this.key,
        );
        check();
        const updatedMeta = {
          salt: meta.salt,
          check: meta.check,
          preferences: encrypted,
        };
        await this._write(signal, (tx) => {
          if (!allowed)
            for (const record of this.records.filter(
              (record) => record.module === module,
            ))
              tx.objectStore("records").delete(record.id);
          tx.objectStore("settings").put(updatedMeta, "vault");
        });
        check();
        this._policyTag = policyTag(updatedMeta);
      }
      this.consent = consent;
      if (!allowed)
        this.records = this.records.filter(
          (record) => record.module !== module,
        );
    });
  }
  async saveSettings() {
    return this._enqueue(async (signal, check) => {
      const prefs = preferences(this);
      if (this.persistent) {
        const meta = await read("settings", "get", signal, "vault");
        check();
        if (!meta) throw Error("Vault metadata is missing. Lock and retry.");
        const encrypted = await seal(prefs, this.key);
        check();
        const cutoff = Date.now() - prefs.retentionDays * 86400000;
        const expired = this.records.filter(
          (record) =>
            !prefs.consent[record.module] ||
            Date.parse(record.timestamp) < cutoff,
        );
        const updatedMeta = {
          salt: meta.salt,
          check: meta.check,
          preferences: encrypted,
        };
        await this._write(signal, (tx) => {
          for (const record of expired)
            tx.objectStore("records").delete(record.id);
          tx.objectStore("settings").put(updatedMeta, "vault");
        });
        check();
        this._policyTag = policyTag(updatedMeta);
        this.records = this.records.filter(
          (record) => !expired.includes(record),
        );
      } else await this._prune(signal, check);
    });
  }
  lock() {
    this._generation++;
    this._active?.abort();
    this.key = null;
    this.persistent = false;
    this.records = [];
    this._vaultTag = null;
    this._policyTag = null;
  }
  async deleteAll() {
    this.lock();
    return this._enqueue(async (signal, check) => {
      if (!globalThis.indexedDB) {
        if (this._vaultKnown)
          throw Error(
            "Session data cleared. Device storage is unavailable, so the saved vault could not be deleted.",
          );
        return;
      }
      await transaction(
        ["records", "settings"],
        "readwrite",
        (tx) => {
          tx.objectStore("records").clear();
          tx.objectStore("settings").clear();
        },
        signal,
      );
      check();
      this._vaultKnown = false;
    });
  }
  async export() {
    return {
      schema: "asha-evidence-v1",
      exportedAt: new Date().toISOString(),
      records: await this.list(),
    };
  }
}
