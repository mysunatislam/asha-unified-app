import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
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
      if (relative === "/" || ["/care", "/patient"].includes(relative))
        relative = "/index.html";
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
