const CACHE = "gymapp-v3";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // La página principal (el HTML) siempre se pide primero a la red, para que
  // una actualización publicada se vea de inmediato. Si no hay internet, se
  // usa la última copia guardada.
  //
  // FIX actualización atascada: `fetch(event.request)` sin más, aunque la
  // intención sea "red primero", sigue las reglas normales de caché HTTP del
  // propio navegador — si esa caché todavía considera "fresca" una respuesta
  // vieja de index.html (con o sin Cache-Control explícito de Vercel), la
  // devuelve sin llegar a pisar el servidor, y por eso la URL con "?v=30"
  // (que no tiene ninguna entrada en esa caché) sí mostraba lo nuevo y la URL
  // normal no. `{ cache: "no-store" }` obliga a esta petición a ignorar esa
  // caché HTTP y pedir siempre el HTML tal cual está publicado ahora mismo.
  const isNavigation = event.request.mode === "navigate" ||
    (event.request.headers.get("accept") || "").includes("text/html");

  if (isNavigation) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // El resto de los archivos (íconos, manifest) sí puede servirse primero
  // desde caché y actualizarse en segundo plano — cambian muy poco.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
