// Service worker do Menu do Dia: abre sem rede e mostra sempre os preços mais recentes quando há ligação.
const SHELL = "menu-do-dia-shell-v1";
const IMGS = "menu-do-dia-img-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["./", "manifest.webmanifest"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, IMGS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // Dados e página: rede primeiro, cache se estiver offline
  if (url.pathname.endsWith("menu.json") || req.mode === "navigate" || url.pathname.endsWith("/")) {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(SHELL).then((x) => x.put(req, c)); return r; }).catch(() => caches.match(req).then((m) => m || caches.match("./"))));
    return;
  }
  // Fotos e restantes ficheiros: cache primeiro (os nomes mudam quando a foto muda)
  e.respondWith(caches.match(req).then((m) => m || fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(IMGS).then((x) => x.put(req, c)); } return r; })));
});
