export const MODEL_REGISTRY = Object.freeze({
  face: {
    id: "mediapipe-face",
    version: "float16/1",
    task: "face",
    className: "FaceLandmarker",
    url: "/neuroface/models/face_landmarker.task",
    bytes: 3758596,
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    license: "Apache-2.0",
    source:
      "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
  pose: {
    id: "mediapipe-pose-lite",
    version: "float16/1",
    task: "pose",
    className: "PoseLandmarker",
    url: "/models/pose_landmarker_lite.task",
    bytes: 5777746,
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    license: "Apache-2.0",
    source:
      "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
});

export async function verifyModel(bytes, expected) {
  if (bytes.byteLength !== expected.bytes)
    throw Error("Model size mismatch. Download was rejected.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex !== expected.sha256)
    throw Error("Model integrity check failed. Download was rejected.");
  return true;
}

const ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
const MANIFEST_URL = "/__asha_verified_pack_manifest__.json";
const queues = new Map();
function validateId(id) {
  if (typeof id !== "string" || id.length > 64 || !ID.test(id))
    throw Error("Invalid model pack ID.");
  return id;
}
function validateVersion(version) {
  if (
    typeof version !== "string" ||
    !VERSION.test(version) ||
    version.includes("..")
  )
    throw Error("Invalid model pack version.");
  return version;
}
function manifest(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack))
    throw Error("Invalid model pack manifest.");
  for (const key of Object.keys(pack))
    if (!["id", "version", "assets", "previous", "signature"].includes(key))
      throw Error("Unsupported manifest field.");
  const id = validateId(pack.id),
    version = validateVersion(pack.version);
  const previous =
    pack.previous === undefined || pack.previous === null
      ? null
      : validateVersion(pack.previous);
  if (
    previous === version ||
    !Array.isArray(pack.assets) ||
    !pack.assets.length ||
    pack.assets.length > 8
  )
    throw Error("Invalid model pack assets or previous version.");
  const urls = new Set();
  let total = 0;
  const assets = pack.assets.map((asset) => {
    if (
      !asset ||
      typeof asset !== "object" ||
      Array.isArray(asset) ||
      Object.keys(asset).some(
        (key) => !["url", "bytes", "sha256"].includes(key),
      )
    )
      throw Error("Unsupported model asset fields.");
    // Single-origin absolute paths only: no protocol-relative host, traversal, escapes, query or fragment.
    if (
      typeof asset.url !== "string" ||
      asset.url.length > 240 ||
      !/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.(task|onnx|bin)$/i.test(asset.url) ||
      asset.url.includes("..") ||
      urls.has(asset.url) ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > 160000000
    )
      throw Error("Model pack contains an unsupported asset.");
    urls.add(asset.url);
    total += asset.bytes;
    return { url: asset.url, bytes: asset.bytes, sha256: asset.sha256 };
  });
  if (total > 320000000) throw Error("Model pack exceeds the supported size.");
  return { id, version, assets, previous };
}
export function canonicalPack(pack) {
  return JSON.stringify(manifest(pack));
}
export async function verifyPack(pack, publicKey) {
  const text = canonicalPack(pack);
  if (
    !publicKey ||
    publicKey.kty !== "EC" ||
    publicKey.crv !== "P-256" ||
    publicKey.d ||
    typeof pack.signature !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(pack.signature) ||
    pack.signature.length !== 88
  ) {
    throw Error(
      "A configured public release trust key and signed manifest are required.",
    );
  }
  let signature;
  try {
    signature = Uint8Array.from(atob(pack.signature), (c) => c.charCodeAt(0));
  } catch {
    throw Error("Model pack signature is invalid.");
  }
  if (
    signature.byteLength !== 64 ||
    btoa(String.fromCharCode(...signature)) !== pack.signature
  )
    throw Error("Model pack signature is invalid.");
  const key = await crypto.subtle.importKey(
    "jwk",
    publicKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      new TextEncoder().encode(text),
    ))
  )
    throw Error("Model pack signature is invalid.");
  return true;
}

const cacheName = (pack) => `asha-pack-${pack.id}--${pack.version}`;
const pointer = (id) => `asha_pack_${id}`;
const previousPointer = (id) => `asha_pack_previous_${id}`;
function exclusive(id, action) {
  const old = queues.get(id) || Promise.resolve();
  const promise = old
    .catch(() => {})
    .then(() =>
      globalThis.navigator?.locks?.request
        ? navigator.locks.request(`asha-model-pack-${id}`, action)
        : action(),
    );
  queues.set(id, promise);
  void promise
    .finally(() => {
      if (queues.get(id) === promise) queues.delete(id);
    })
    .catch(() => {});
  return promise;
}

async function boundedBytes(response, expected) {
  const announced = response.headers?.get("Content-Length");
  if (announced && Number(announced) !== expected)
    throw Error("Model size mismatch. Download was rejected.");
  if (!response.body?.getReader) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== expected)
      throw Error("Model size mismatch. Download was rejected.");
    return bytes;
  }
  const reader = response.body.getReader(),
    bytes = new Uint8Array(expected);
  let position = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (position + value.byteLength > expected)
        throw Error("Model download exceeded its signed size.");
      bytes.set(value, position);
      position += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (position !== expected)
    throw Error("Model size mismatch. Download was rejected.");
  return bytes.buffer;
}

/** Downloaded packs stay feature-disabled until a real production trust key is configured.
 * Web Locks serialize tabs where supported; the in-realm queue alone is not a cross-tab transaction.
 * Consumers must use the verified pack, never treat arbitrary localStorage/cache names as trust.
 */
export class ModelPackStore {
  constructor(publicKey) {
    this.publicKey = publicKey ? structuredClone(publicKey) : null;
  }
  async _verifiedCache(name, id) {
    if (
      typeof name !== "string" ||
      !name.startsWith(`asha-pack-${id}--`) ||
      !(await caches.keys()).includes(name)
    )
      throw Error("Verified model pack cache is unavailable.");
    const cache = await caches.open(name),
      response = await cache.match(MANIFEST_URL);
    if (!response)
      throw Error("Cached pack has no signed verification manifest.");
    const pack = await response.json();
    await verifyPack(pack, this.publicKey);
    if (pack.id !== id || cacheName(pack) !== name)
      throw Error("Cached model pack identity is invalid.");
    for (const asset of pack.assets) {
      const bytes = await cache.match(asset.url);
      if (!bytes) throw Error("Cached model asset is missing.");
      await verifyModel(await boundedBytes(bytes, asset.bytes), asset);
    }
    return { cache, pack };
  }
  _activate(id, current, previous) {
    const before = localStorage.getItem(pointer(id)),
      oldPrevious = localStorage.getItem(previousPointer(id));
    try {
      if (previous) localStorage.setItem(previousPointer(id), previous);
      else localStorage.removeItem(previousPointer(id));
      localStorage.setItem(pointer(id), current);
    } catch (error) {
      // A failed pointer update must not cause a valid active cache to be deleted.
      try {
        before === null
          ? localStorage.removeItem(pointer(id))
          : localStorage.setItem(pointer(id), before);
        oldPrevious === null
          ? localStorage.removeItem(previousPointer(id))
          : localStorage.setItem(previousPointer(id), oldPrevious);
      } catch {
        /* Storage can remain unavailable; both referenced caches are still verified and retained. */
      }
      throw error;
    }
  }
  async install(input) {
    // Snapshot before awaiting to prevent signed-manifest mutation during download.
    const pack = { ...manifest(input), signature: input.signature };
    await verifyPack(pack, this.publicKey);
    return exclusive(pack.id, async () => {
      const name = cacheName(pack),
        current = localStorage.getItem(pointer(pack.id));
      let previous = null;
      if (current)
        previous = (await this._verifiedCache(current, pack.id)).pack;
      if (current === name) {
        if (canonicalPack(previous) !== canonicalPack(pack))
          throw Error("A model version is immutable. Publish a new version.");
        return name;
      }
      if (pack.previous && previous?.version !== pack.previous)
        throw Error(
          "Pack previous version does not match the installed release.",
        );
      if ((await caches.keys()).includes(name)) {
        const existing = await this._verifiedCache(name, pack.id);
        if (canonicalPack(existing.pack) !== canonicalPack(pack))
          throw Error("A model version is immutable. Publish a new version.");
        this._activate(pack.id, name, current);
        return name;
      }
      const stagingName = `${name}-staging-${crypto.randomUUID()}`;
      const staging = await caches.open(stagingName);
      let finalStarted = false,
        finalVerified = false;
      try {
        for (const asset of pack.assets) {
          const response = await fetch(asset.url, {
            cache: "no-store",
            redirect: "error",
            credentials: "same-origin",
          });
          if (!response.ok || response.redirected)
            throw Error("Model download failed.");
          const bytes = await boundedBytes(response, asset.bytes);
          await verifyModel(bytes, asset);
          await staging.put(
            asset.url,
            new Response(bytes, {
              headers: { "Content-Length": String(asset.bytes) },
            }),
          );
        }
        // Cache API has no rename. Commit verified bytes then a signed completion marker, then pointers.
        const target = await caches.open(name);
        finalStarted = true;
        for (const asset of pack.assets)
          await target.put(asset.url, await staging.match(asset.url));
        await target.put(
          MANIFEST_URL,
          new Response(JSON.stringify(pack), {
            headers: { "Content-Type": "application/json" },
          }),
        );
        await this._verifiedCache(name, pack.id);
        finalVerified = true;
        this._activate(pack.id, name, current);
        return name;
      } catch (error) {
        if (
          finalStarted &&
          !finalVerified &&
          localStorage.getItem(pointer(pack.id)) !== name
        )
          await caches.delete(name);
        throw error;
      } finally {
        await caches.delete(stagingName);
      }
    });
  }
  async rollback(id) {
    validateId(id);
    return exclusive(id, async () => {
      const previous = localStorage.getItem(previousPointer(id)),
        current = localStorage.getItem(pointer(id));
      if (!previous || previous === current)
        throw Error("No previous verified pack is available.");
      await this._verifiedCache(previous, id);
      if (current) await this._verifiedCache(current, id);
      this._activate(id, previous, current);
      return previous;
    });
  }
  async evict(id) {
    validateId(id);
    return exclusive(id, async () => {
      // Disable references first; deletion failure cannot leave an active partial cache.
      localStorage.removeItem(pointer(id));
      localStorage.removeItem(previousPointer(id));
      for (const name of await caches.keys())
        if (name.startsWith(`asha-pack-${id}--`)) await caches.delete(name);
    });
  }
}
