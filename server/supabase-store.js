// Server-only persistence. No Supabase key or URL is shipped to the browser.
const table = "asha_objects";

export function createSupabaseStore({
  url = process.env.SUPABASE_URL,
  secret = process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl = fetch,
} = {}) {
  function config() {
    if (!url || !secret) throw Error("Supabase storage is not configured");
    const project = new URL(url);
    if (project.protocol !== "https:" || project.username || project.password)
      throw Error("Supabase URL must use HTTPS");
    return project;
  }

  async function request(method, filters = {}, value, prefer) {
    const project = config();
    const target = new URL(`/rest/v1/${table}`, project);
    for (const [key, item] of Object.entries(filters))
      target.searchParams.set(key, String(item));
    const headers = {
      apikey: secret,
      accept: "application/json",
      ...(value === undefined ? {} : { "content-type": "application/json" }),
      ...(prefer ? { prefer } : {}),
    };
    // Legacy service_role keys are JWTs. New sb_secret keys belong only in apikey.
    if (!secret.startsWith("sb_secret_"))
      headers.authorization = `Bearer ${secret}`;
    const response = await fetchImpl(target, {
      method,
      headers,
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      let code = "";
      try {
        code = (await response.json()).code || "";
      } catch {}
      throw Error(
        `Supabase storage ${method} failed (${response.status}${code ? `, ${code}` : ""})`,
      );
    }
    return method === "GET" ? response.json() : null;
  }

  return {
    async read(path) {
      const rows = await request("GET", {
        select: "value",
        path: `eq.${path}`,
        limit: 1,
      });
      return rows[0]?.value ?? null;
    },
    async write(path, value, overwrite = false) {
      await request(
        "POST",
        overwrite ? { on_conflict: "path" } : {},
        { path, value, updated_at: new Date().toISOString() },
        overwrite
          ? "resolution=merge-duplicates,return=minimal"
          : "return=minimal",
      );
    },
    async list(prefix, max = 500) {
      const paths = [];
      while (paths.length < max) {
        const limit = Math.min(1000, max - paths.length);
        const rows = await request("GET", {
          select: "path",
          path: `like.${prefix}*`,
          order: "path.asc",
          limit,
          offset: paths.length,
        });
        paths.push(...rows.map((row) => row.path));
        if (rows.length < limit) break;
      }
      return paths;
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 50) {
        const batch = paths.slice(i, i + 50);
        const filter = `in.(${batch.map((path) => `"${path.replaceAll('"', '\\"')}"`).join(",")})`;
        await request("DELETE", { path: filter }, undefined, "return=minimal");
      }
    },
  };
}

export const supabaseStore = createSupabaseStore();
