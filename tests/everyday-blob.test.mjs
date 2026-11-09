import test from "node:test";
import assert from "node:assert/strict";
import { createBlobStore } from "../server/store.js";

test("Private authorization and consent reads bypass stale overwritten Blob JSON", async () => {
  let cached = { grant: true },
    current = cached;
  const adapter = createBlobStore({
    getImpl: async (path, options) => {
      assert.equal(path, "consent.json");
      assert.equal(options.access, "private");
      return {
        statusCode: 200,
        stream: new Blob([
          JSON.stringify(options.useCache === false ? current : cached),
        ]).stream(),
      };
    },
    putImpl: async (_, text, options) => {
      assert.equal(options.access, "private");
      assert.equal(options.allowOverwrite, true);
      current = JSON.parse(text);
    },
  });
  assert.equal((await adapter.read("consent.json")).grant, true);
  await adapter.write("consent.json", { grant: false }, true);
  assert.equal((await adapter.read("consent.json")).grant, false);
});
test("Blob private adapter retains null, pagination and deletion behavior", async () => {
  const removed = [];
  const adapter = createBlobStore({
    getImpl: async () => null,
    listImpl: async ({ cursor }) =>
      cursor
        ? { blobs: [{ pathname: "b" }], hasMore: false }
        : { blobs: [{ pathname: "a" }], hasMore: true, cursor: "next" },
    delImpl: async (keys) => removed.push(...keys),
  });
  assert.equal(await adapter.read("missing"), null);
  assert.deepEqual(await adapter.list("", 2), ["a", "b"]);
  await adapter.remove([]);
  await adapter.remove(["a"]);
  assert.deepEqual(removed, ["a"]);
});
