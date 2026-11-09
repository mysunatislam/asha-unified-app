const CACHE = "asha-live-v1";
const EVERYDAY_CACHE = 'asha-everyday-v1';
const EVERYDAY_ASSETS = ['/everyday.html', '/app/everyday/main.js', '/app/everyday/style.css', '/app/everyday/fonts.css',
  '/app/everyday/contracts.js', '/app/everyday/evidence.js', '/app/everyday/platform.js', '/app/everyday/model-registry.js',
  '/app/everyday/safety.js', '/app/everyday/companion-safety.js', '/app/everyday/care.js', '/app/everyday/clinic.js', '/app/everyday/nutrition.js', '/app/everyday/foods.js',
  '/app/everyday/move.js', '/app/everyday/move-engine.js', '/app/everyday/eyespeak.js', '/app/everyday/gaze-engine.js',
  '/app/speech-capture.js', '/assets/assets/images/asha-avatar.png', '/assets/brand/asha-favicon-48.png'];
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["./app/style.css", "./app/icon.svg"]))
      .then(() => caches.open(EVERYDAY_CACHE).then((c) => c.addAll(EVERYDAY_ASSETS)))
      .catch(() => {}),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// Only immutable model assets are cached. Private API responses are never cached.
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (event.request.method === 'GET' && u.origin === self.location.origin && EVERYDAY_ASSETS.includes(u.pathname)) {
    event.respondWith(caches.open(EVERYDAY_CACHE).then(async (cache) => {
      try { const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }
      catch { const hit = await cache.match(event.request, { ignoreSearch: true }); if (hit) return hit; throw Error('Open Everyday once while online to use its offline tools.'); }
    }));
    return;
  }
  if (
    event.request.method === "GET" &&
    u.origin === self.location.origin &&
    (/\.(task|onnx|wasm)$/.test(u.pathname) || u.pathname.startsWith('/neuroface/vendor/'))
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const r = await fetch(event.request);
        if (r.ok) cache.put(event.request, r.clone());
        return r;
      }),
    );
  }
});
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data?.json() || {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(d.title || "Asha · new request", {
      body: d.body || "Open your caregiver dashboard.",
      tag: d.tag,
      icon: "./assets/brand/asha-icon-192.png",
      badge: "./assets/brand/asha-icon-192.png",
      data: { url: "./?role=caregiver" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (list) => {
        const url = new URL("./?role=caregiver", self.registration.scope).href;
        for (const c of list)
          if (c.url.startsWith(self.registration.scope)) {
            await c.navigate(url);
            return c.focus();
          }
        return self.clients.openWindow(url);
      }),
  );
});
