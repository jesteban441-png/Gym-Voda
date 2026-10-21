# V48.1B — series inline del borrador nativo

La pantalla nativa y sus pruebas están implementadas; no se ejecutó SQL, no se
activó ninguna cuenta y no se modificaron archivos no rastreados preexistentes.
Los archivos de V48.1A se usan sin modificarlos. No se convirtió ninguna sesión.

## Separación de flujos

- V47/heredada conserva su pantalla, mapas sets/setLogs y funcionamiento anterior.
- Nativa schemaVersion=48 usa snapshot day y array sets. El contenedor conservado
  en V48.1A (unresolvedSession) ahora se interpreta mediante nativeSession() para
  este formato válido. No hay segunda sesión: el mismo borrador se renderiza,
  se edita y se persiste. Datos nativos no interpretables se conservan bloqueados.
- Las cuentas no activadas siguen iniciando sesiones heredadas. No se crea una
  sesión nativa local como sustituto de una reserva online.
- El inicio nativo nuevo permanece bloqueado hasta conectar reserva online con
  infraestructura desplegada. Sin conexión se rechaza explícitamente. El helper
  requestStart solo reserva si online y ready; no activa cuentas ni genera historial.

## Registro

Todas las filas están visibles, con controles táctiles >=44 px y texto de inputs
16 px. Edición text/inputmode decimal para peso (coma o punto); numeric para reps.
Peso 0 es válido. Vacío, negativos, infinito y repeticiones no enteras positivas
no permiten completar. Cada checkbox es independiente. Si una edición vuelve
inválida una serie marcada, solo esa serie se desmarca. Otras marcas no cambian.

El valor visible se guarda inmediatamente en el modelo, sin recrear inputs ni
perder foco. El último texto incompleto/erróneo se conserva en session.ui.inputs;
el valor de la fila es NULL cuando no es válido. Los errores no se convierten en
series realizadas. session.ui es metadato local y NO debe enviarse como payload
de series a SQL. En C se enviarán solo los campos definidos del array.

La referencia visible procede exclusivamente de referenciasEjercicios, resolviendo
el nombre canónico y seleccionando la última referencia explícita si hay alias.
No se deduce desde registros ni se precargan datos como realizados. No se modifica
esa referencia definitiva desde B.

Terminar ejercicio pide la pregunta aprobada con Guardar referencia / No guardar.
Ambas opciones conservan las series completas. La decisión es accepted + snapshot
de series completas, dentro de session.references[exerciseInstance]. Se confirma
solo en el cierre futuro. Cambiar las completadas invalida esa decisión y se pide
otra al volver a terminar; cambiar únicamente una incompleta no cambia el snapshot.
Elegir una respuesta sobre un snapshot ya modificado se rechaza. Ambas respuestas
permiten avanzar visualmente al siguiente ejercicio sin bloquear el orden libre.

## Persistencia

Se usa la misma cola e IndexedDB de V48.1A, aislado por usuario, con CAS local y
copias de conflictos. Antes del adaptador remoto se intercepta cualquier sesión
schemaVersion=48: se mantiene pending local y NO se llama Store.saveRutina ni RPC.
La UI reconoce el resultado como guardado local, sin afirmar sincronización remota.
Recargar recupera el borrador cuando su base remota sigue coincidiendo. Conflictos
no se fusionan silenciosamente; siguen bloqueados como en A. Un cambio de usuario
invalida callbacks y la pregunta abierta; no guarda la respuesta en otra cuenta.

Finalizar está deshabilitado para nativas y protegido además en finalizeSession.
No hay INSERT/UPDATE de registros, INSERT de entrenos, actualización definitiva
de referencias ni cálculo nuevo de duración. No se modifica el Timer.

## Pruebas y reproducción

`tests-v48b-runner.cjs` sirve archivos localmente en navegador aislado y bloquea
TODO HTTPS. Usa Auth/Supabase simulado; no puede escribir en producción. Ejecuta
tests-v48b.html, tests-v48.html intacto, recargas reales y tests-v31.html completo.

```powershell
$env:V48_BROWSER_CHANNEL = 'msedge' # o navegador de desarrollo instalado
node tests-v48b-runner.cjs
```

Playwright se resuelve desde NODE_PATH si se usa el runtime de Codex. No se añade
dependencia al producto, build system ni framework. Las capturas claro/oscuro se
guardan en un directorio temporal único fuera del repositorio.

Se verifican controles móviles en viewport 390x844. La emulación Chromium/Edge
no sustituye probar Safari/iPhone real, teclado virtual y almacenamiento iOS.

## Preparado para C

Conectar la reserva online y sincronización de series al SQL ya preparado cuando
esté instalado/probado, sin activar una cuenta hasta soportar todas sus escrituras.
Mantener el inicio/sessionId/snapshot reservados inmutables; validar la coherencia
de referencias por canónico antes de cerrar, incluida repetición del mismo ejercicio.
No usar el cierre legado como alternativa al cierre RPC nativo.

El arranque completamente offline continúa fuera de alcance: la aplicación aún
lee los historiales al iniciar. La página ya abierta admite edición local sin red;
una recarga recupera el borrador al poder cargar los datos existentes de la cuenta.
