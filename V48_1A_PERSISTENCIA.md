# V48.1A — infraestructura del cliente

Implementado sin SQL, activación de cuentas ni cambios de la pantalla de entrenamiento.

- `v48-persistence.js`: repositorio, cola por contexto de usuario, IndexedDB y
  constructor puro del formato futuro. Una fila local por usuario; variantes en
  conflicto preservadas aparte. No hay otro sistema de sesiones de servidor.
- `index.html`: Store/persistRutina, preservación de claves, restauración y aislamiento
  de cargas/guardados. Cuenta/sesión cambian de contexto con generación; las respuestas
  antiguas no modifican la nueva cuenta. Cerrar sesión no borra borradores persistidos.
- `sw.js`: precache del módulo versionado. Se conserva exclusión de Supabase y medios.
- `tests-v48.html` y `tests-v48-runner.cjs`: pruebas con IndexedDB real y navegador aislado.

## Compatibilidad de despliegue

`VodaFitPersistence.capabilities` es constante y está congelada en
`{metadata:false,rpc:false}`. Con esta entrega se consulta SOLO `rutinas.data`,
se conserva el upsert heredado y no se llama ninguna RPC. No existe activador
cliente de `cliente_v48` ni flag que pueda encenderse desde URL/localStorage.
La lectura de metadata y CAS están implementadas como camino futuro e inyectadas
solo en pruebas. Encenderlas requiere otra entrega tras instalar/probar SQL.

Sin SQL no hay CAS atómico: se relee el remoto antes de upsert y se bloquean
discrepancias, pero sigue existiendo la ventana entre lectura y escritura. No
presentar esa comprobación como garantía contra dos dispositivos concurrentes.

IndexedDB guarda el borrador ANTES de intentar red. Al reabrir, se recupera si su
base coincide con la remota; si el servidor ya tiene el mismo contenido, se usa
ese contenido. Si discrepan, se conservan las copias y se bloquea sincronización;
no se fusionan por hora ni se reenvía silenciosamente una copia local antigua.
CAS local evita que dos pestañas pisen el borrador de la otra. Los conflictos y
sus variantes pueden inspeccionarse mediante la API de infraestructura; su
interfaz de resolución queda para otra etapa. No borrar IndexedDB para resolverlos.

La recuperación sin red existe en la capa de borradores. El arranque completo
de la aplicación todavía requiere las lecturas existentes de historial/Supabase;
no se implementó un historial offline ni un modo offline completo. Si IndexedDB
falla, se informa y no se afirma que exista respaldo local. El usuario puede borrar
los datos del navegador; no es un backup externo.

## Límite deliberado entre etapas

La UI actual usa mapas sets/setLogs; el SQL V48 usa arrays y snapshot. Se prepara
`createSessionDraft` con UUID estable y copia independiente del día, pero NO se
inicia ni convierte una sesión nativa desde esa UI. Una sesión V48 encontrada se
conserva y bloquea reemplazarla; una heredada sin día también se conserva sin
descartarla. Se mantiene el comportamiento de series y Timer anterior.

No se implementan activación, reserva online, RPC de series, referencias, cierre
ni borrado V48. Tampoco se corrige el cierre legado no transaccional: hasta migrar,
sus limitaciones históricas de red siguen vigentes. V48.1B debe conectar el nuevo
formato con la pantalla y completar el transporte autenticado para las RPC, sin
activar cuentas hasta soportar todas sus escrituras y la transición heredada.

## Reproducción de pruebas

Con Node y Playwright de desarrollo disponibles (sin agregar dependencias a la app):

```powershell
$env:V48_BROWSER_CHANNEL = 'msedge' # opcional: navegador instalado
node tests-v48-runner.cjs
```

El runner sirve archivos en 127.0.0.1, usa contexto de navegador nuevo, bloquea
Service Workers e intercepta TODO HTTPS. SDK Auth simulado; ninguna llamada real
a Supabase. Ejecuta pruebas V48, recarga de página real y harness V31 completo.
Si Playwright está en el runtime de Codex, agregar ese directorio a NODE_PATH.
Pruebas de Service Worker, Safari/iPhone real y transporte Supabase quedan pendientes.
