// The build inserts the digest of each shipped runtime file, including lazy chunks and Workers.
const scope = self.registration.scope;
const prefix = "mashed-offline:" + scope + ":";
const cacheName = prefix + "__SHELL_REVISION__";
const files = new Map(Object.entries(__SHELL_FILES__).map(([path, digest]) => [new URL(path, scope).href, digest]));
const index = new URL("index.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const requests = Array.from(files, ([url, integrity]) => new Request(url, { cache: "reload", integrity }));
    // addAll commits the batch only when every file of this build is available.
    try {
      await cache.addAll(requests);
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Normal activation waits for tabs using the previous build to close.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    url.search = "";
    if (url.href !== scope && url.href !== index) return;
    event.respondWith(caches.match(index, { cacheName }).then((hit) => hit || fetch(request)));
  } else if (files.has(url.href)) {
    event.respondWith(caches.match(request, { cacheName }).then((hit) => hit || fetch(request)));
  }
});
