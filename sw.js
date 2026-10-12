// V40.1: v6 -> v7. El bump NO es para que llegue el Service Worker nuevo
// (eso ya pasa solo porque cambió este archivo), sino para EVACUAR la caché
// anterior: los clientes que ya tienen "gymapp-v6" guardaron ahí respuestas
// REST de Supabase con la estrategia vieja, y el handler de `activate` borra
// toda caché cuyo nombre no sea el actual. Sin el bump esas entradas se
// quedarían guardadas para siempre, aunque de ahora en más no se agreguen más.
//
// V44.3: v7 -> v8, por el mismo motivo y con otro contenido a evacuar. V44.2
// reemplazó los GIF de ejecución por WebP, así que las entradas .gif que un
// dispositivo ya tenía guardadas quedaron huérfanas: el HTML nuevo no las pide
// nunca más, no se vencen solas y `activate` sólo borra cachés con OTRO nombre.
// Sin el bump se quedaban ocupando lugar para siempre (decenas de MB en un
// dispositivo donde se hayan abierto muchas fichas). El costo del bump es
// volver a bajar el index.html y los 7 íconos del precache.
const CACHE = "gymapp-v8";
const ASSETS = ["./", "./index.html", "./manifest.json", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png", "./icon-512-maskable.png", "./favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // V38.1: se piden con `cache: "reload"` en vez de usar cache.addAll() a
    // secas. addAll() pasa por la caché HTTP normal del navegador, así que una
    // versión NUEVA del Service Worker podía poblarse con los BYTES VIEJOS de
    // un ícono que esa caché todavía consideraba fresco — y servirlos como si
    // fueran los nuevos, porque abajo los assets se resuelven cache-first.
    // Es el mismo problema que ya se había arreglado para el HTML en el
    // handler de navegación, que no se había aplicado a los assets.
    caches.open(CACHE).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: "reload" })
          .then((resp) => (resp && resp.status === 200) ? cache.put(url, resp) : null)
          .catch(() => {})
      ))
    ).catch(() => {})
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

// V40.1: ¿esta URL es del backend de Supabase?
//
// La exclusión es por ORIGEN, no por una lista de endpoints: así cubre REST
// (/rest/v1/...), Auth (/auth/v1/...), Storage (/storage/v1/...) y cualquier
// endpoint futuro —incluidas las URLs firmadas de Storage— sin tener que
// enumerarlos ni actualizar esta lista cuando aparezca uno nuevo.
//
// Se compara contra el host de Supabase en general en vez de contra el id del
// proyecto, para no duplicar acá la constante SUPABASE_URL que vive en
// index.html y que quedaría desincronizada si el proyecto cambiara.
function isSupabaseUrl(url) {
  const h = url.hostname;
  return h === "supabase.co" || h.endsWith(".supabase.co");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // V40.1: las peticiones a Supabase salen de la estrategia de caché ANTES de
  // cualquier otra cosa.
  //
  // Qué estaba mal: el handler de abajo no filtraba por origen, así que toda
  // petición GET que no fuera navegación caía en la rama cache-first. Los GET
  // de Supabase son exactamente eso (los POST ya se iban por el `method`
  // check), de modo que las respuestas REST terminaban guardadas en el Cache
  // Storage y servidas desde ahí: datos potencialmente desactualizados, y
  // —en cuanto existan fotos privadas con URL firmada— archivos privados
  // guardados en una caché de disco que no se limpia al cerrar sesión. Se
  // confirmó mirando el cache real: "gymapp-v6" tenía entradas de
  // /rest/v1/peso_corporal y /rest/v1/registros.
  //
  // Por qué `return` y no `event.respondWith(fetch(event.request))`: salir
  // sin responder deja que el navegador haga la petición como si no hubiera
  // Service Worker, con su semántica original intacta (credenciales,
  // redirecciones, streaming). Reemitirla desde acá sería una petición
  // nueva y una indirección sin ninguna ganancia.
  //
  // No se agrega NINGUNA estrategia de caché para Supabase: la idea es
  // justamente que el Service Worker no se meta.
  if (isSupabaseUrl(new URL(event.request.url))) return;

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

  // V44: las animaciones de ejecución salen de la estrategia de abajo.
  //
  // No se agregan a ASSETS (no se precargan: son ~40 MiB y la mayoría no se
  // mira nunca), pero el problema no era el precache sino la REVALIDACIÓN: la
  // rama de abajo arma `fetchPromise` SIEMPRE, incluso cuando ya hay copia en
  // caché, y devuelve `cached || fetchPromise`. Para un ícono de 4 KB eso es
  // gratis; para una animación de cientos de KB significa volver a bajar el
  // archivo completo cada vez que se abre la ficha, con la copia al lado.
  //
  // Acá se hace cache-first SECO: si está en caché se sirve y no se pide nada.
  // Es seguro porque estos archivos son INMUTABLES por convención — el nombre
  // deriva del nombre canónico del ejercicio (hip-thrust-con-barra.webp), así
  // que reemplazar el contenido exige cambiarle el nombre o bumpear CACHE. Si
  // algún día se pisa una animación manteniendo el nombre, hay que bumpear.
  //
  // V44.2: el formato pasó de GIF a WebP animado. Se siguen cubriendo las dos
  // extensiones a propósito — es una rama por TIPO DE RECURSO, no por formato,
  // y un cliente con el Service Worker viejo todavía puede tener .gif en su
  // caché. Las láminas anatómicas son .jpg/.png y no entran acá.
  if (/\.(gif|webp)$/i.test(new URL(event.request.url).pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        // Sin caché y sin red: se responde un 504 vacío en vez de dejar que el
        // fetch handler explote. El <img> dispara onerror y la ficha esconde la
        // tarjeta de ejecución entera, que es el mismo camino que un archivo
        // faltante. El resto de la ficha no se entera.
        .catch(() => new Response("", { status: 504, statusText: "sin conexión" })))
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
