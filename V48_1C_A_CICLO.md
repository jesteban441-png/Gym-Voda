# V48.1C-A — Inicio y ciclo de vida nativo

Implementación local, sin SQL ejecutado, activación, commit, push ni deploy.
El flujo nativo permanece cerrado por las capacidades inmutables de V48.1A
(`metadata:false`, `rpc:false`); las pruebas usan adaptadores locales explícitos.

## Archivos de esta etapa

- `index.html`: adaptador autenticado de reserva, integración con inicio,
  recuperación limitada del borrador nativo sin red, duración y cierre pendiente.
- `sw.js`: incorpora el módulo de ciclo de vida al shell offline.
- `v48-lifecycle.js`: solicitud estable, reserva confirmada, CAS local,
  validación temporal y preparación del cierre.
- `tests-v48ca.html` y `tests-v48ca-runner.cjs`: pruebas locales y regresiones.

Se reutilizan `VodaFitPersistence.createCache/createSync` y `VodaFitSession`.
Los módulos y pruebas A/B preexistentes no se modificaron. No hay otra tabla,
base IndexedDB de producto ni sistema paralelo de sesiones: se mantiene el mismo
registro por propietario en `vodafit-rutina-drafts`.

## Inicio y recuperación

1. Sin conexión o capacidades/esquema/cuenta no habilitados: no reservar ni
   crear una sesión. No se prueban columnas/RPC nuevas mediante errores.
2. Antes de enviar, persistir `draft.__v48StartRequest` con UUID, revisión,
   instante del toque, zona IANA, fecha local, slot y día. Es una solicitud
   pendiente, nunca una sesión activa. Para Día Especial incluye su snapshot.
   No se inicia con cambios locales anteriores pendientes de sincronización.
3. Llamar exclusivamente `v48_iniciar(p_revision,p_sesion,p_slot,p_dia_id,
   p_inicio_ms,p_zona,p_dia_especial)`. Capturar el token del propietario
   autenticado antes del envío; no reutilizar un token de otra cuenta.
4. Exigir una respuesta válida con revisión posterior y el snapshot nativo del
   mismo UUID/día/slot/inicio/zona, sin comprobante terminal. La RPC propuesta
   serializa por la fila de `rutinas`; reconoce el mismo intento antes del CAS.
5. Adoptar la respuesta en el mismo registro IndexedDB mediante comparación de
   versión, y recargar con el sincronizador A. Un conflicto conserva las copias.
   Una pérdida de respuesta conserva la solicitud y reintenta exactamente ese
   UUID y timestamp, incluso tras recargar. Nunca se fabrica éxito local.

El inicio repetido se bloquea tanto por la sesión remota como por la copia local;
las llamadas concurrentes del mismo controlador comparten la promesa. Otras
pestañas pasan por CAS local y, finalmente, por la exclusión atómica del backend.
Una solicitud de otro día pendiente debe resolverse antes de generar otra.

## Duración y preparación del cierre

- Inicio: instante del toque confirmado por la reserva. El snapshot y la zona
  autoritativos quedan en `sesionActiva`. La fecha local se deriva de ambos;
  también se conserva en la solicitud y en el cierre pendiente.
- Duración: `fin - startedAt`, o `Date.now() - startedAt` mientras sigue activa.
  El intervalo únicamente repinta texto; no cuenta segundos ni persiste ticks.
  Al volver a primer plano se recalcula. No hay pausa ni edición manual.
- Finalizar exige resolver las decisiones de referencia de los ejercicios con
  series completadas. La confirmación fija una sola vez `lifecycle.endedAt` y
  `lifecycle.status='pending_finalization'`, junto con una copia estable de las
  series y decisiones. El identificador de la operación es el mismo sessionId.
- Después del cierre se bloquea la edición. Reintentar sólo vuelve a guardar el
  mismo cierre local; no cambia su hora y no hace RPC ni crea historial.
- `persistRutina()` mantiene ese borrador en el IndexedDB A. Si falla el guardado
  se informa y se conserva en memoria para reintentar; no se anuncia éxito.

La recuperación sin red requiere que Supabase Auth entregue el usuario conocido
localmente y que exista su borrador nativo. Si perfil/rutina/historial no están
disponibles, se permite continuar únicamente desde la pantalla recuperada del
entrenamiento; no se presenta el resto de la cuenta como cargado. Sin una
identidad autenticada conocida no se buscan ni muestran borradores ajenos.
La ausencia del SDK/shell offline o la eliminación del almacenamiento del sitio
por el sistema operativo no se resuelve desde este módulo.

## Validación local

Ejecutar con Node y Playwright de desarrollo:

```powershell
$env:NODE_PATH='C:/Users/Voda/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
$env:V48_BROWSER_CHANNEL='msedge'
& 'C:/Users/Voda/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' tests-v48ca-runner.cjs
```

El runner intercepta HTTPS, bloquea service workers y usa contextos aislados.
No accede a Supabase real. Cubre 16 casos C-A; conserva las suites B (13),
A (17) y V31 (527 casos ejecutados dos veces: 1054 ejecuciones). Incluye
recargas reales de solicitud incierta y cierre offline con backend inaccesible,
así como las recargas A/B. Comprueba ausencia de errores JS y desborde móvil;
produce capturas de los temas claro y oscuro para revisión.

La reserva SQL y sus permisos necesitan validación transaccional en staging
cuando se autorice ejecutar el paquete. El bloqueo físico de un iPhone y sus
políticas de expulsión de IndexedDB no se ensayan con Edge: queda prueba manual
en Safari/PWA antes de habilitar cuentas. La medida usa el reloj del dispositivo;
no introduce una fuente horaria del servidor ni cambia el contrato SQL aprobado.

## V48.1C-B

Pendiente conectar el cierre definitivo (`v48_finalizar`) y su comprobante,
resolver revisiones y estados terminales remotos, reconciliar el borrador tras
la confirmación y actualizar historial/calendario/referencias mediante la
transacción ya diseñada. No se llama todavía `v48_guardar_sesion`,
`v48_finalizar`, `v48_cancelar`, `v48_eliminar` ni `v48_activar`.

Esta etapa no modifica el SQL propuesto, datos/permiso de Supabase, referencias
finales, sesiones heredadas, Timer manual, descanso, mapa muscular ni historial.
Antes de activar capacidades hay que probar las RPC en staging y completar C-B;
esta infraestructura no constituye una habilitación de producto en producción.
