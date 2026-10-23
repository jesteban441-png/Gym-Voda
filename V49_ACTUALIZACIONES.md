# VodaFit V49 — implementación local para revisión

Fecha: 2026-10-21. Base: `8ac108f3ee335419df3bd6cc4797678b7b3c696f`.
Estado al 2026-10-23: publicación autorizada por el usuario, condicionada a verificación final.

## Alcance y archivos

- `index.html`: coordinador de actualizaciones, protección de trabajo en curso,
  identidad de contenido y SRI de scripts/CSS. Indicador de versión V49 local.
- `sw.js`: instalación verificada, shell coherente por worker, coordinación de
  ventanas y recuperación offline. Mantiene los medios fuera del precache.
- `v49-release.cjs`: herramienta local de integridad, sin dependencias. No compila,
  empaqueta ni cambia la arquitectura estática. Verifica por defecto; `--seal`
  actualiza sólo las referencias de integridad del HTML y el manifiesto del worker.
- `tests-v49-runner.cjs`: pruebas específicas con navegador/worker/IndexedDB reales,
  servidor loopback y autenticación simulada.
- Este informe.

No se modifican los cinco módulos V48, formatos/nombres/versiones de IndexedDB,
Supabase URL/clave, SQL, contratos de sesión, Timer, catálogo ni medios. No hay
migraciones, librerías nuevas, activación de cuentas ni segundo sistema de sesiones.

## Estados y protocolo

1. Comprobar al abrir, `online`, `pageshow` y volver a visible. Mientras la página
   está visible, comprobar versiones cada 60 segundos y reevaluar seguridad cada
   3 segundos. Los fallos de conexión conservan la versión actual.
2. El worker descarga y valida los 22 recursos esenciales: estado HTTP, tipos de
   contenido de HTML/JS/CSS y SHA-256. Un recurso inválido hace fallar `install`.
   Sólo se escriben respuestas después de validar el conjunto completo. Si falla
   la escritura de una caché nueva se elimina esa caché; nunca la anterior activa.
3. El HTML se sirve desde el shell del worker activo, incluso con conexión. Esto
   reemplaza deliberadamente el antiguo HTML network-first. Los scripts tienen
   URL por contenido y SRI; el worker no obtiene un script histórico de un nuevo
   deployment cuando falta su copia. Un recurso ausente falla cerrado con 503.
4. Un worker en espera consulta a **todas** las ventanas dentro del scope:
   `VF_PROBE` → `VF_PREPARE` → `VF_COMMIT`. La preparación bloquea brevemente las
   interacciones sólo después de que todos respondan disponibles. Se vuelve a
   comprobar el estado y la lista de clientes antes de `skipWaiting()`.
5. Cliente ocupado, desconocido, cerrado durante la consulta o sin respuesta:
   aplazar; un timeout de 2,5 segundos jamás significa consentimiento. Un aborto
   libera el bloqueo. Un watchdog local de 8 segundos libera la pantalla si se
   pierde al worker. No se fuerza la recarga de una pestaña suspendida.
6. Tras `controllerchange`, cada página verifica otra vez su seguridad y la
   identidad del worker. Recarga una sola vez por identidad de contenido, con
   guardia en `sessionStorage` por pestaña. No basta una etiqueta de versión: una
   edición con la misma etiqueta también produce identidad distinta.

Las carreras tardías se contienen además conservando shells anteriores: si una
ventana aparece después de la última consulta o cambia su estado, su controlador
puede cambiar pero su recarga vuelve a pasar por las guardas. Los recursos antiguos
versionados no se sustituyen por bytes nuevos. No se borran cachés de otras apps.

## Qué impide o permite una recarga

| Estado | Política |
| --- | --- |
| Autenticación/carga incompleta o error de arranque | Esperar |
| Sesión V47, sesión V48 activa o borrador no interpretable | Esperar |
| Timer de descanso o cronómetro en marcha | Esperar, sin alterar sus cálculos |
| Formulario editado, diálogo abierto, interacción reciente | Esperar; no guardar ni descartar por iniciativa del actualizador |
| Operación observada en curso | Esperar su resolución |
| Guardado fallido sin copia local ni éxito remoto | Esperar otro guardado confirmado |
| Conflicto local/remoto o reconciliación pendiente de resolución | Esperar resolución existente |
| Borrador pendiente confirmado en IndexedDB | Permitido si coincide exactamente con el documento en memoria y no hay otro impedimento |
| Cierre nativo pendiente con hora ya congelada | Permitido si coincide exactamente con el borrador durable, sin conflicto/operación/Timer/formulario |
| Intención incierta de historial V48 guardada en el journal | Se conserva; no se reenvía ni borra por actualizar |
| Resultado fallido/incierto sin journal recuperable | Aplazar conservadoramente hasta un reintento coincidente confirmado; no reintentar escrituras automáticamente |

La observación de promesas envuelve las operaciones existentes; no cambia sus
argumentos, resultados ni rutas de escritura. La actualización no exige que todos
los pendientes hayan llegado a Supabase. Tampoco introduce una sincronización
general al reconectar: se mantienen los mecanismos de recuperación/reintento V48.

## Primera transición V48 → V49

V48 no entiende el protocolo. Mientras exista una ventana V48, no responde a la
consulta y **veta la activación forzada**. Puede continuar su entrenamiento sin
recarga del nuevo worker. Una ventana V49 abierta por el HTML network-first de V48
tampoco obtiene permiso para expulsar a esa ventana antigua.

Procedimiento de validación y futura transición: completar/guardar el trabajo en
V48; cuando ya sea seguro, cerrar naturalmente todas las ventanas/PWA de ese origen
y reabrir con conexión. No desinstalar, borrar almacenamiento ni limpiar caché. Al
quedar sin clientes, el navegador puede activar el worker ya instalado. Una vez
cargado V49, las transiciones siguientes usan la coordinación automática.

Límite inevitable: no se pueden instalar guardas retroactivas en el JavaScript
V48 que sigue ejecutándose. Su HTML network-first y su caché mutable siguen
existiendo hasta la transición. Una descarga inicial V49 interrumpida bajo ese
worker puede dejar una pantalla que necesite reabrirse con conexión. La integridad
impide ejecutar módulos alterados; no transforma al worker V48 en un instalador
atómico. La prueba de transición cubre un paquete completo, convivencia y reapertura;
no promete una migración instantánea de una PWA antigua suspendida indefinidamente.

## Integridad de cada entrega

Después de cualquier cambio en HTML o recursos esenciales:

```powershell
node v49-release.cjs --seal
node v49-release.cjs
```

El primer comando modifica únicamente `index.html`/`sw.js`; el segundo es de
lectura. Revisar esos cambios como parte de la entrega. HTML y worker deben declarar
la misma etiqueta (`APP_RELEASE`/`RELEASE`). El sello genera identidad de contenido,
queries por hash, SRI y manifiesto. No editar recursos después de sellar sin repetir
la verificación. LF/CRLF se contemplan explícitamente: SHA-256 textual normaliza
sólo finales de línea y SRI incluye ambas representaciones; binarios son exactos.

## Pruebas y límites

Resultados finales sobre los archivos locales:

- `tests-v49-runner.cjs`: **20/20 escenarios aprobados**, exit code 0.
- `tests-v48rc-runner.cjs`: **3/3 recorridos aprobados**, exit code 0; un único
  commit simulado por cierre, UUID/hora estables y cero solicitudes externas.
- `node v49-release.cjs`: integridad/SRI/identidades/sintaxis aprobadas.
- `node --check` de las dos herramientas CJS y `git diff --check`: aprobados.
- HEAD continúa en `8ac108f3`; los cinco módulos V48 y las constantes Supabase
  coinciden con el baseline. Archivos ajenos preexistentes conservados.

Durante el desarrollo se corrigió una carrera de `registration.waiting`, se
añadió la consulta previa para no bloquear repetidamente ante clientes ausentes
y se corrigió el polling del test antes de cortar la red. Los resultados de arriba
corresponden a la pasada final; no quedan fallos abiertos en esos escenarios.

Ejecutar `node tests-v49-runner.cjs` con Playwright disponible en NODE_PATH. Se usa
Edge Chromium headless, sin instalar dependencias en el repositorio. Las versiones
simuladas se construyen en memoria y no se escriben en los archivos del producto.
El baseline V48 se lee del commit indicado. En las copias se sustituyen URL/clave
por valores sintéticos y el SDK Auth por un doble local; se bloquea tráfico externo.

Cobertura específica: actualización única; recursos 404/alterados; HTML y módulo
con identidades distintas; sesiones V47/V48 y no interpretables; cronómetro;
formulario modificado; varias pestañas; cliente sin respuesta; pendientes durables
y journal incierto; cierre nativo offline con UUID/hora estables; guardado en curso
y fallo local; finales de línea Git; reconexión; contenido nuevo con misma etiqueta;
conflictos; resultado remoto sin journal; cambio de estado durante preparación;
transición V48→V49 con cliente antiguo abierto y reapertura offline.

Regresión relacionada: `tests-v48rc-runner.cjs`, sólo los tres recorridos de cierre
offline, respuesta perdida tras COMMIT simulado y cancelación/calendario. No se
ejecuta la batería completa V48 ni SQL. Las antiguas aserciones de V31/validador V48
que exigen network-first, nombre de caché anterior y query `48.rc1` ya no describen
el diseño autorizado; no se modifica el producto para satisfacerlas.

Limitaciones de la validación inicial (actualizadas por el cierre del 2026-10-23): probar iPhone y Android físicos, cabeceras reales de
Preview, suspensión/reanudación del sistema, autenticación del Preview y tolerancia
a presión real de almacenamiento. Chromium de escritorio no certifica Safari iOS.
La actualización es al abrir/volver/conectarse y alcanzar un punto seguro; no hay
promesa de ejecución mientras el sistema mantiene cerrada o suspendida la PWA.

Se retienen shells anteriores conservadoramente para clientes tardíos. Esto puede
aumentar el uso de Cache Storage con sucesivas entregas; no se incorpora una purga
automática en V49. La caché nueva de medios se comparte entre entregas y aprovecha
medios ya disponibles en cachés históricas. Mantener la convención existente de
nombres inmutables de medios. La eliminación de almacenamiento por el sistema o
por el usuario queda fuera de la garantía de actualización.

## Preview aislado (pasos futuros, no ejecutados)

1. Preparar una copia aislada de estos archivos; no publicar ni empujar `main`.
   Usar un origen HTTPS de Preview estable, distinto de producción y fuera de su
   scope. Mantener ese mismo origen entre las dos entregas de prueba.
2. En esa copia sustituir las constantes Supabase por el staging existente y
   cuentas sintéticas, o usar backend simulado con bloqueo de producción. Las
   variables de entorno de Vercel no sustituyen esas constantes por sí solas.
   No activar cuentas ni ejecutar migraciones como parte de esta validación.
3. Sellar/verificar la copia después de cambiar su configuración. Comprobar que
   no contiene el host de producción y que los redirects Auth pertenecen al
   entorno de pruebas. Verificar acceso real a cada recurso esencial, MIME y
   ausencia de redirecciones a pantallas de autenticación del hosting.
4. Instalar el baseline aislado en iPhone y Android; preparar una cuenta sintética
   compatible y otra ya activada en staging. Conservar el almacenamiento entre
   entregas. Probar primero V48→V49 siguiendo el procedimiento anterior.
5. Publicar únicamente en ese Preview una versión posterior sellada. Probar
   sesión activa, cierre durable offline, formulario, Timer, dos ventanas, volver
   de segundo plano y reconexión. Introducir un recurso faltante/alterado sólo en
   el Preview y comprobar que no reemplaza el shell operativo.
6. Registrar versiones/builds, número de recargas, UUID/horas y borradores antes y
   después. Una URL distinta por deployment no sustituye la prueba sobre el mismo
   origen instalado. Revisar resultados juntos antes de autorizar producción.

No se realizó commit, push, deploy, migración, escritura a Supabase producción ni
activación de usuarios durante esta implementación.

## Cierre autorizado — 2026-10-23

El usuario confirmó V49 instalada desde el icono en iPhone 13 y apertura en modo avión. Aceptó explícitamente como limitaciones la transición completa no verificada en iOS y Android físico no verificado. No se requiere configurar autenticación staging para este cierre.

Se conservan los resultados 20/20 V49 y 3/3 regresiones relacionadas; no se repitió la batería. La transición adicional sobre el mismo alias HTTPS de Preview pasó con paquetes reales: V48 abierto mantiene el nuevo worker esperando; cierre/reapertura activa V49; registro sintético pendiente de IndexedDB conservado exactamente; arranque offline correcto; cero errores JavaScript y cero solicitudes externas. Se verificaron bytes y cabeceras publicados. No se probó login ni guardado remoto.

La publicación se limita a index.html, sw.js, v49-release.cjs, tests-v49-runner.cjs y V49_ACTUALIZACIONES.md. Se conserva la configuración Supabase original de 8ac108f. Sin migraciones ni activaciones. Main activa el deployment Git del proyecto gym-voda; no se publican los paquetes staging en producción.

## Recuperación si aparece un problema

Baseline Git: 8ac108f3ee335419df3bd6cc4797678b7b3c696f. Deployment productivo previo: dpl_BMGSgak2tJ7yyzLivJo7MAupccAM (gym-voda-8x9tlozw4-mi-cartera1.vercel.app). Conservar esta referencia.

1. Detener nuevas publicaciones y conservar IndexedDB, localStorage y cachés. No desinstalar ni borrar datos.
2. Preferir una corrección mínima sobre el protocolo V49, con nueva identidad sellada, para preservar la coordinación. Si hace falta volver al baseline, revertir únicamente el commit V49 en main y publicar mediante el flujo Git habitual; no resetear ni forzar el historial.
3. Para una restauración urgente del hosting, usar Rollback del proyecto gym-voda al deployment previo registrado. El rollback del hosting no revierte automáticamente clientes offline ni almacenamiento local. Mantener Git alineado antes de una nueva publicación.
4. V48 tiene skipWaiting incondicional: NO tratar su rollback como actualización coordinada V49. Antes de volver a V48, terminar/guardar el trabajo, cerrar todas las ventanas y reabrir con conexión. No prometer reversión sin interrupción sobre clientes ocupados.
5. Verificar URL, worker, recursos esenciales y recuperación de datos. No realizar cambios SQL ni limpieza de almacenamiento para recuperar el cliente.
