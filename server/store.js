import { get, list, put, del } from "@vercel/blob";

export const profilePath = (id) => `demo/${id}/profile.json`;
export const statusPath = (id) => `demo/${id}/status.json`;
export const eventPrefix = (id) => `demo/${id}/events/`;

export const blobStore = {
  async read(path) {
    const result = await get(path, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  },
  async write(path, value, overwrite = false) {
    await put(path, JSON.stringify(value), {
      access: "private",
      contentType: "application/json",
      allowOverwrite: overwrite,
      cacheControlMaxAge: 0,
    });
  },
  async list(prefix, max = 500) {
    const paths = [];
    let cursor;
    do {
      const page = await list({ prefix, limit: 100, cursor });
      paths.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && paths.length < max);
    return paths.slice(0, max);
  },
  async remove(paths) {
    if (paths.length) await del(paths);
  },
};
