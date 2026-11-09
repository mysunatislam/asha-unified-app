import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createClinicService, ClinicError } from '../server/clinic.js';
import { createCareService } from '../server/care-service.js';
import { createMairaProvider } from '../server/maira-provider.js';
// Explicit preview storage. Nothing here is claimed as cloud persistence.
const memory = new Map();
const localStore = { read: async (k) => structuredClone(memory.get(k) ?? null),
  write: async (k, v) => memory.set(k, structuredClone(v)),
  list: async (prefix, limit = 5000) => [...memory.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit),
  remove: async (keys) => keys.forEach((k) => memory.delete(k)) };
const localClinic = createClinicService(localStore);
const localCare = createCareService(createMairaProvider());
async function readBody(req, max = 20000) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > max) throw new ClinicError(413, 'Request too large.'); }
  try { return JSON.parse(data || '{}'); } catch { throw new ClinicError(400, 'Invalid JSON.'); }
}
const root = path.resolve("."),
  port = Number(process.env.PORT || 4180);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".onnx": "application/octet-stream",
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (['/api/clinic', '/api/care'].includes(url.pathname)) {
        res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
        try {
          if (req.method !== 'POST') throw new ClinicError(405, 'Method not allowed');
          const input = await readBody(req);
          const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
          let result;
          if (url.pathname === '/api/clinic') {
            if (input.action === 'create') {
              if (input.confirmed !== true) throw new ClinicError(400, 'Confirm workspace creation.');
              result = await localClinic.create(input.name);
            } else result = await localClinic.run(input.tenant, bearer, input);
            result.storageMode = 'local-memory';
          } else {
            // Urgent guidance needs neither an account nor the upstream service.
            const { evaluateSafety, safetyMessage } = await import('../app/everyday/safety.js');
            const safety = evaluateSafety(input.text, { region: input.region, redFlags: input.redFlags });
            if (!safety.allowLLM) result = { reply: safetyMessage(safety, input.language), safety, generated: false };
            else {
              const auth = await fetch('https://neurobridge-asha-live.vercel.app/api/session?patientId=' + encodeURIComponent(input.patientId || ''), { headers: { Authorization: 'Bearer ' + bearer }, signal: AbortSignal.timeout(6000) });
              if (!auth.ok) throw new ClinicError(401, 'Reopen your private cloud session.');
              result = await localCare.explain(input);
            }
          }
          res.end(JSON.stringify(result));
        } catch (error) { res.statusCode = error instanceof ClinicError ? error.status : 503; res.end(JSON.stringify({ error: error instanceof ClinicError ? error.message : 'Cloud assistance is unavailable in this local preview. Local journals and urgent guidance work.' })); }
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const r = await fetch(
          "https://neurobridge-asha-live.vercel.app" +
            url.pathname +
            url.search,
          {
            method: req.method,
            headers: {
              ...Object.fromEntries(
                Object.entries(req.headers).filter(([k]) =>
                  ["content-type", "authorization"].includes(k),
                ),
              ),
              origin: "https://neurobridge-asha-live.vercel.app",
            },
            body: ["GET", "HEAD"].includes(req.method)
              ? undefined
              : await new Promise((resolve) => {
                  let data = "";
                  req.on("data", (c) => (data += c));
                  req.on("end", () => resolve(data));
                }),
          },
        );
        res.statusCode = r.status;
        res.setHeader("content-type", "application/json");
        res.end(await r.text());
        return;
      }
      let relative = decodeURIComponent(url.pathname);
      if (relative === "/") relative = "/index.html";
      if (["/app", "/app/", "/care", "/patient"].includes(relative))
        relative = "/app.html";
      const file = path.resolve(root, "." + relative);
      if (!file.startsWith(root + path.sep)) throw Error("outside");
      const stat = await fs.stat(file);
      const target = stat.isDirectory() ? path.join(file, "index.html") : file;
      res.setHeader(
        "Content-Type",
        types[path.extname(target)] || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-cache");
      res.end(await fs.readFile(target));
    } catch {
      res.statusCode = 404;
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () =>
    console.log("Asha preview: http://127.0.0.1:" + port),
  );
