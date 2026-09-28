const CACHE = "asha-live-v1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["./app/style.css", "./app/icon.svg"]))
      .catch(() => {}),
  );
});
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// Only immutable model assets are cached. Private API responses are never cached.
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (
    event.request.method === "GET" &&
    u.origin === self.location.origin &&
    /\.(task|onnx|wasm)$/.test(u.pathname)
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
      icon: "./icons/asha-192.png",
      badge: "./app/icon.svg",
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
