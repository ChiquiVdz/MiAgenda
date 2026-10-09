/* Only the generic shell and fingerprinted public assets are cached here.
   Private data lives in account-isolated IndexedDB, never HTML or API caches. */
const CACHE = "miagenda-shell-d7c4fb2b2204e086";
const APP = new Set(["/", "/local", "/inbox", "/agenda", "/hoy", "/cocina", "/cocina/inicio", "/cocina/recetas", "/cocina/planificar", "/cocina/compras"]);
self.addEventListener("install", event => event.waitUntil(prepareShell().then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("miagenda-shell-") && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
let preparing;
async function prepareShell() {
  if (preparing) return preparing;
  preparing = (async () => {
    const cache = await caches.open(CACHE);
    if (await cache.match("/local")) {
      for (const client of await self.clients.matchAll()) client.postMessage({ type: "MIAGENDA_SHELL_READY" });
      return;
    }
    const response = await fetch("/local", { cache: "no-store", credentials: "omit" });
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("shell");
    const html = await response.clone().text(), urls = new Set([
      new URL("/manifest.webmanifest", self.location.origin).href,
      ...["icon-192.png", "icon-512.png", "apple-touch-icon.png"].map(name => new URL(`/icons/${name}`, self.location.origin).href),
    ]);
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const url = new URL(match[1].replaceAll("&amp;", "&"), self.location.origin);
      if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) urls.add(url.href);
    }
    if (![...urls].some(url => new URL(url).pathname.startsWith("/_next/static/"))) throw new Error("assets");
    // Commit shell last: it must never reference partially downloaded assets.
    await Promise.all([...urls].map(async url => {
      if (await cache.match(url)) return;
      const asset = await fetch(url, { cache: "force-cache", credentials: "omit" });
      if (!asset.ok) throw new Error("asset");
      await cache.put(url, asset);
    }));
    await cache.put("/local", response);
    for (const client of await self.clients.matchAll()) client.postMessage({ type: "MIAGENDA_SHELL_READY" });
  })();
  try { await preparing; } finally { preparing = null; }
}
self.addEventListener("message", event => { if (event.data?.type === "PREPARE_SHELL") event.waitUntil(prepareShell().catch(() => {})); });
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && APP.has(url.pathname)) {
    event.respondWith((async () => (await caches.open(CACHE)).match("/local").then(saved => saved ?? fetch(request)))());
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) event.respondWith((async () => {
    const cache = await caches.open(CACHE), saved = await cache.match(request);
    if (saved) return saved;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
