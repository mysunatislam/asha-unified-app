import assert from "node:assert/strict";
import { test } from "node:test";
import { createSupabaseStore } from "../server/supabase-store.js";

test("Supabase store keeps the existing private read/write/list/remove contract", async () => {
  const rows = new Map();
  const calls = [];
  const fetchImpl = async (target, options) => {
    const url = new URL(target);
    calls.push({ url, options });
    assert.equal(url.origin, "https://example.supabase.co");
    assert.equal(options.headers.apikey, "sb_secret_test");
    assert.equal(options.headers.authorization, undefined);
    const filter = url.searchParams.get("path");
    if (options.method === "GET") {
      const values = [...rows].sort(([a], [b]) => a.localeCompare(b));
      const matching = filter.startsWith("eq.")
        ? values.filter(([key]) => key === filter.slice(3))
        : values.filter(([key]) => key.startsWith(filter.slice(5, -1)));
      const selected = matching.slice(
        Number(url.searchParams.get("offset") || 0),
        Number(url.searchParams.get("offset") || 0) +
          Number(url.searchParams.get("limit") || 1000),
      );
      return Response.json(
        selected.map(([path, value]) =>
          url.searchParams.get("select") === "path" ? { path } : { value },
        ),
      );
    }
    if (options.method === "POST") {
      const { path, value } = JSON.parse(options.body);
      if (rows.has(path) && !url.searchParams.has("on_conflict"))
        return Response.json({ code: "23505" }, { status: 409 });
      rows.set(path, value);
      return new Response(null, { status: 201 });
    }
    if (options.method === "DELETE") {
      for (const [, path] of filter.matchAll(/"([^"]+)"/g)) rows.delete(path);
      return new Response(null, { status: 204 });
    }
    throw Error(`Unexpected method ${options.method}`);
  };
  const store = createSupabaseStore({
    url: "https://example.supabase.co",
    secret: "sb_secret_test",
    fetchImpl,
  });
  assert.equal(await store.read("asha-live/v1/a/profile.json"), null);
  await store.write("asha-live/v1/a/profile.json", { name: "A" });
  await store.write("asha-live/v1/a/events/1.json", { kind: "water" });
  await store.write("asha-live/v1/b/profile.json", { name: "B" });
  await assert.rejects(
    () => store.write("asha-live/v1/a/profile.json", {}),
    /409, 23505/,
  );
  await store.write("asha-live/v1/a/profile.json", { name: "Updated" }, true);
  assert.deepEqual(await store.read("asha-live/v1/a/profile.json"), {
    name: "Updated",
  });
  assert.deepEqual(await store.list("asha-live/v1/a/", 10), [
    "asha-live/v1/a/events/1.json",
    "asha-live/v1/a/profile.json",
  ]);
  assert.equal((await store.list("asha-live/v1/", 1)).length, 1);
  await store.remove(await store.list("asha-live/v1/a/", 10));
  assert.equal(await store.read("asha-live/v1/a/profile.json"), null);
  assert.deepEqual(await store.list("asha-live/v1/", 10), [
    "asha-live/v1/b/profile.json",
  ]);
  assert.ok(
    calls.some(({ options }) =>
      options.headers.prefer?.includes("merge-duplicates"),
    ),
  );
});

test("Supabase store uses an Authorization bearer only for legacy service-role JWTs", async () => {
  const store = createSupabaseStore({
    url: "https://example.supabase.co",
    secret: "legacy.jwt.key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.apikey, "legacy.jwt.key");
      assert.equal(options.headers.authorization, "Bearer legacy.jwt.key");
      return Response.json([]);
    },
  });
  assert.equal(await store.read("missing"), null);
});
