import { get, list, put, del } from "@vercel/blob";

export const profilePath = (id) => `demo/${id}/profile.json`;
export const statusPath = (id) => `demo/${id}/status.json`;
export const eventPrefix = (id) => `demo/${id}/events/`;

export function createBlobStore({
  getImpl = get,
  listImpl = list,
  putImpl = put,
  delImpl = del,
} = {}) {
  return {
    async read(path) {
      // These JSON objects contain live authorization, consent and receipts.
      // Private Blob overwrites otherwise remain cached for up to a minute.
      const result = await getImpl(path, {
        access: "private",
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const text = await new Response(result.stream).text();
      return JSON.parse(text);
    },
    async write(path, value, overwrite = false) {
      await putImpl(path, JSON.stringify(value), {
        access: "private",
        contentType: "application/json",
        allowOverwrite: overwrite,
        cacheControlMaxAge: 60,
      });
    },
    async list(prefix, max = 500) {
      const paths = [];
      let cursor;
      do {
        const page = await listImpl({ prefix, limit: 100, cursor });
        paths.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor && paths.length < max);
      return paths.slice(0, max);
    },
    async remove(paths) {
      if (paths.length) await delImpl(paths);
    },
  };
}
export const blobStore = createBlobStore();
