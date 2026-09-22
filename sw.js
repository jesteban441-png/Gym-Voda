From 84d5ce86631767255ea6f307c603c007a71f4fad Mon Sep 17 00:00:00 2001
From: Claude <noreply@anthropic.com>
Date: Tue, 22 Sep 2026 01:52:13 +0000
Subject: [PATCH] Fix PWA cache update behavior

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014qBWojLkU1xvikzNBeWK6e
---
 index.html | 29 ++++++++++++++++++++++++++++-
 sw.js      | 13 +++++++++++--
 2 files changed, 39 insertions(+), 3 deletions(-)

diff --git a/index.html b/index.html
index 165cfdf..7d3a91e 100644
--- a/index.html
+++ b/index.html
@@ -5589,8 +5589,35 @@
     }
 
     // register service worker for installability (best-effort)
+    // FIX actualización atascada: antes se registraba sin más y, aunque
+    // Vercel ya tuviera publicado un index.html nuevo, el navegador podía
+    // tardar en darse cuenta de que sw.js cambió (o de que hay una versión
+    // nueva del Service Worker activo) hasta la próxima vez que revisara por
+    // su cuenta. Ahora, además de registrar:
+    // 1. `updateViaCache:"none"` evita que la caché HTTP del navegador
+    //    interfiera con la revisión del propio sw.js.
+    // 2. `reg.update()` fuerza esa revisión apenas arranca la app (y de
+    //    nuevo si el usuario vuelve a la pestaña después de tenerla en
+    //    segundo plano), en vez de esperar a que el navegador lo haga solo.
+    // 3. Cuando un Service Worker nuevo toma el control, se recarga la
+    //    página UNA sola vez para mostrar la versión nueva sin que haya que
+    //    agregar "?v=30" a mano ni borrar datos — salvo que haya un
+    //    entrenamiento en curso (state.session), para no cortar un Timer o
+    //    una serie a mitad de registro: en ese caso la versión nueva ya
+    //    quedó instalada y se aplica sola en la próxima recarga natural.
     if("serviceWorker" in navigator){
-      navigator.serviceWorker.register("sw.js").catch(()=>{});
+      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg)=>{
+        reg.update().catch(()=>{});
+        document.addEventListener("visibilitychange", ()=>{
+          if(document.visibilityState === "visible") reg.update().catch(()=>{});
+        });
+        let refreshed = false;
+        navigator.serviceWorker.addEventListener("controllerchange", ()=>{
+          if(refreshed || state.session) return;
+          refreshed = true;
+          window.location.reload();
+        });
+      }).catch(()=>{});
     }
   }
 
diff --git a/sw.js b/sw.js
index 8214ac6..c91340c 100644
--- a/sw.js
+++ b/sw.js
@@ -1,4 +1,4 @@
-const CACHE = "gymapp-v2";
+const CACHE = "gymapp-v3";
 const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
 
 self.addEventListener("install", (event) => {
@@ -23,12 +23,21 @@ self.addEventListener("fetch", (event) => {
   // La página principal (el HTML) siempre se pide primero a la red, para que
   // una actualización publicada se vea de inmediato. Si no hay internet, se
   // usa la última copia guardada.
+  //
+  // FIX actualización atascada: `fetch(event.request)` sin más, aunque la
+  // intención sea "red primero", sigue las reglas normales de caché HTTP del
+  // propio navegador — si esa caché todavía considera "fresca" una respuesta
+  // vieja de index.html (con o sin Cache-Control explícito de Vercel), la
+  // devuelve sin llegar a pisar el servidor, y por eso la URL con "?v=30"
+  // (que no tiene ninguna entrada en esa caché) sí mostraba lo nuevo y la URL
+  // normal no. `{ cache: "no-store" }` obliga a esta petición a ignorar esa
+  // caché HTTP y pedir siempre el HTML tal cual está publicado ahora mismo.
   const isNavigation = event.request.mode === "navigate" ||
     (event.request.headers.get("accept") || "").includes("text/html");
 
   if (isNavigation) {
     event.respondWith(
-      fetch(event.request)
+      fetch(event.request, { cache: "no-store" })
         .then((resp) => {
           if (resp && resp.status === 200) {
             const copy = resp.clone();
-- 
2.43.0