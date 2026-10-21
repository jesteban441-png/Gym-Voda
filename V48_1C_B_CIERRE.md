# V48.1C-B — Finalización y reconciliación

Implementado localmente. NO se ejecutó SQL, se accedió a Supabase, se activaron
cuentas ni se hizo commit/push/deploy. Capacidades de producción intactas:
`metadata:false`, `rpc:false`. La publicación no está autorizada.

## Archivos de esta etapa

Modificados: `index.html`, `sw.js`.
Nuevos: `v48-reconcile.js`, `tests-v48cb.html`, `tests-v48cb-runner.cjs`, este
informe, `supabase/v48/07_cierre_canonico.sql` y
`supabase/v48/08_pruebas_canonicas.sql`.

Los módulos, pruebas, documentos y SQL no rastreados preexistentes se leyeron
pero no se modificaron. El nuevo módulo compone V48.1A/B/C-A y usa el MISMO
IndexedDB y registro por usuario; no hay segunda fuente de sesiones.

## Contrato y flujo

- `VodaFitReconcile.payload`: usa la copia congelada C-A, conserva UUID y fin;
  valida el plan y cada serie completada. La RPC exige todas las filas del plan:
  las incompletas viajan con `completed:false,peso:null,reps:null`; nunca se
  insertan como registros realizados. No hay INSERT cliente de registros/entrenos.
- Decisiones por instancia: `{accepted:boolean,sets:[...]}`. Se exige coincidencia
  exacta con las series completadas; no se inventa una aceptación ante cambios.
  Las rechazadas también viajan para validar la decisión; SQL no modifica su
  referencia definitiva. Instancias del mismo ejercicio canónico con referencias
  aceptadas diferentes provocan conflicto, nunca una elección silenciosa.
- Adaptador: `v48_estado(p_sesion)`,
  `v48_finalizar(p_revision,p_sesion,p_fin_ms,p_series,p_referencias)`,
  `v48_cancelar(p_revision,p_sesion)` y `v48_eliminar(p_sesion)`.
  Conserva el transporte C-A con token capturado del propietario. No concede
  permisos ni llama activación. Comprueba capacidades, cuenta y respuesta.
- Antes de cada operación se consulta `v48_estado`. Si el cierre ya aparece como
  `finalizada`, se repite la RPC de finalización para que SU hash compruebe que
  corresponde al mismo payload: el comprobante público no contiene el hash.
  La revisión puede actualizarse; UUID, fin, series y decisiones permanecen.
- Si aún está activa, sólo se usa la revisión nueva si el snapshot y el estado
  remoto de sesión siguen iguales a la base local. Cambios remotos de series
  provocan conflicto. Cambios independientes de rutina no se pisan.
- Una respuesta perdida no limpia el borrador. Se vuelve a consultar estado y
  validar el cierre mediante la RPC idempotente. Un resultado ambiguo tampoco
  confirma el descarte. Se bloquean operaciones concurrentes del controlador.
- El CAS de IndexedDB confirma la adopción del sobre remoto. Si falla, se
  conservan las copias y se vuelve a reconciliar; no se anuncia éxito local.
  Las rutinas modificadas localmente se preservan como patch pendiente si son
  compatibles con el estado remoto. Si ambas copias cambiaron la misma clave,
  se bloquea con conflicto en vez de perder alguna.
- Sólo tras comprobante inequívoco se adopta el remoto y se recargan registros y
  entrenos. Los mapeadores conservan vínculo, tiempos y zona de sesiones nativas;
  una fila heredada sigue con duración `null`, nunca una duración inventada.
  Si falla la lectura del historial después del cierre se conserva lo ya mostrado
  y se avisa que falta actualizarlo; no se vuelve a guardar el entrenamiento.

`index.html` mantiene el cierre pendiente visible incluso si la rutina remota
ya no tiene sesión y A detecta conflicto con su borrador local. Las series siguen
bloqueadas. La rutina remota no se sobrescribe con ese cierre.

## Comprobantes terminales y operaciones seguras

- Eliminada/cancelada: un cierre viejo no llama finalización ni resucita datos.
  Conserva el borrador hasta decisión explícita del usuario.
- Finalizada con distinto payload: `IDEMPOTENCY_CONFLICT`; no descarta la copia.
- La acción "Resolver con el estado remoto" pide confirmación de descarte y
  vuelve a consultar el comprobante. `acceptTerminal(...,true)` sólo adopta un
  estado terminal existente; no crea historial ni aplica referencias locales.
- Cancelación preparada en `nativeReconciler.cancel`: sólo una sesión nativa
  activa, nunca un cierre pendiente. Su intención se persiste y puede recuperarse.
  No se agregó botón de cancelación; su futura UI debe confirmar antes de llamar.
- El tacho existente del calendario usa `nativeReconciler.remove` únicamente para
  sesiones con `sessionId`; confirma que elimina también sus series. Para las
  heredadas conserva el flujo anterior. Borrar usa RPC/comprobante, nunca DML
  directo de una sesión V48. Referencias aceptadas no se borran al borrar sesión.
- Cancelar/eliminar/resolver guardan `__v48TerminalRequest` en el mismo borrador
  antes del envío; se recupera después de una respuesta perdida. No se puede
  iniciar otra sesión mientras exista esa operación. Por prudencia, eliminar
  desde este cliente se bloquea si tiene otra sesión local activa, evitando
  adoptar un sobre remoto que descarte su progreso local.

Los conflictos entre ramas locales de distintas pestañas conservan las copias y
bloquean la sincronización. Esta etapa no incorpora un editor general de ramas
ni borra esas copias para forzar el guardado.

## Diferencia SQL corregida localmente

`02_rpc.sql` usaba el nombre literal del snapshot para filas y referencias. Eso
podía separar un alias de su ejercicio canónico. `07_cierre_canonico.sql` añade un
helper privado con el catálogo/alias/índice normalizado YA existentes en la app y
reemplaza únicamente la obtención del nombre en el cuerpo de `v48_finalizar`.
Mantiene firma, transacción, RLS, comprobantes, hash y validación originales.
No reescribe filas anteriores. El helper conserva nombres desconocidos y claves
ambiguas, igual que el cliente. Su catálogo debe actualizarse junto al de la app.

No cambia el contrato de series ni amplía RPC con un mapa de nombres enviado por
el cliente. El servidor decide la identidad canónica al escribir. El helper no
es ejecutable por PUBLIC/anon/authenticated/service_role. La función finalizadora
vuelve a quedar sin EXECUTE hasta 04. No aplicar 07 a producción habilitada sin
un procedimiento de permisos separado: este paquete sigue sin instalarse.

## Pruebas locales y límites

Runner: `tests-v48cb-runner.cjs`, con Node/Playwright del entorno de desarrollo y
`V48_BROWSER_CHANNEL=msedge`. Intercepta HTTPS y no contacta Supabase real.

- C-B: 32/32 casos con backend simulado.
- C-A: 16/16; B: 13/13; A: 17/17.
- V31: 1054/1054 ejecuciones (527 casos ejecutados dos veces).
- Recarga REAL después de COMMIT simulado con respuesta perdida: pasa; también
  las cuatro recargas reales A/B/C-A. Sin errores JS ni desborde móvil detectado.
- Sintaxis JavaScript y SQL comprobada offline. El parseo SQL no demuestra
  privilegios, transacciones, collation ni comportamiento del PostgreSQL real.

El backend simulado comprueba el protocolo del cliente; no es evidencia de que
las RPC estén instaladas ni de su atomicidad real. Safari/PWA y permisos reales
siguen siendo pruebas obligatorias de staging. No se tocó Timer, descanso, mapa
muscular ni se convirtió ninguna sesión heredada.

## Procedimiento concreto de staging (futuro, no ejecutado)

1. Crear proyecto aislado con el esquema verificado y sólo datos sintéticos.
   Guardar snapshot restaurable de ese proyecto. Comprobar que URLs/identidades
   son de staging, nunca producción. Crear dos usuarios Auth con sus profiles
   vacíos; las pruebas 05 requieren que no tengan rutina/registros/entrenos.
2. Aplicar explícitamente **01 → 02 → 03 → 07 → 04** como postgres, una transacción
   por archivo. Este orden sustituye al README anterior para C-B. NO ejecutar
   por orden alfabético ni incluir 06 en instalación: 06 contiene inicios como
   contingencia. Ante un error, detenerse, ROLLBACK si corresponde y revisar
   qué archivos confirmaron; no repetir CREATE indiscriminadamente.
3. Ejecutar 05 sólo en staging: pegar sus dos `set_config('v48.test_a',UUID,true)`
   y `v48.test_b` dentro de su BEGIN, antes del DO, usando los dos perfiles
   sintéticos. Termina ROLLBACK. Ejecutar después 08: 755 casos de paridad
   canónica, sin consultar tablas de usuarios, también termina ROLLBACK.
4. En una COPIA aislada del cliente apuntada a staging, habilitar capacidades
   sólo para pruebas y activar únicamente usuarios sintéticos mediante la RPC
   prevista, con revisión vigente y sin sesión heredada. No cambiar el cliente
   de producción ni habilitar banderas desde URL/localStorage. Este trabajo
   todavía no hizo esos cambios ni esas activaciones.
5. Probar por HTTP autenticado real (no sólo SQL Editor como postgres):
   - anon no puede ejecutar RPC sensibles; otro usuario no puede leer/cerrar/
     cancelar/eliminar ni vincular registros ajenos. Helpers privados inaccesibles.
   - Iniciar, marcar series fuera de orden con peso cero, aceptar referencia de
     un alias y rechazar otra. Finalizar: un entreno, sólo filas completadas,
     fecha local de inicio, inicio/fin originales, duración exacta, referencia
     canónica aceptada actualizada y rechazada intacta, borrador remoto limpio.
   - Repetir misma sesión/fin/series/referencias con revisión vieja y arrays en
     otro orden: mismo entreno y mismos registros. Cambiar fin o valor: conflicto.
   - Simular pérdida de RESPUESTA tras COMMIT, no sólo desconectar antes de
     enviar. Recargar PWA y reconciliar: consultar estado antes del replay,
     conservar UUID/fin y no duplicar. Repetir cierre realmente offline y reconectar.
   - Dos conexiones simultáneas: cierres idénticos; cierres diferentes; guardar
     sesión contra cierre; cancelar contra cerrar; eliminar contra replay.
     Verificar estado terminal único y ausencia de huérfanos/duplicados.
   - Eliminar con confirmación: CASCADE sólo sobre sus series, comprobante
     eliminada conservado, referencias intactas. Replay antiguo no resucita.
   - Cambiar rutina en otro dispositivo: preservar cambios independientes;
     conflictos en series o en la misma clave no se sobrescriben.
   - Bloquear teléfono, cerrar/reabrir Safari y PWA, refrescar token, cerrar
     sesión y cambiar de usuario. Borradores y operaciones nunca se mezclan.
   - Conservar una sesión heredada con registros previos, terminarla por flujo
     legado y comparar sus filas antes/después; ningún INSERT de conversión.
6. En staging, inyectar errores tras INSERT entreno, INSERT series, UPDATE refs
   y antes del comprobante: rollback de TODA la operación, incluida revisión.
   Usar una variante de función de prueba o transacción de pruebas, nunca
   agregar un parámetro de fallo a la RPC de producto. Restaurar la definición
   original del paquete al terminar y repetir el caso exitoso.
7. Registrar resultados, contar filas por sesión/usuario, comparar referencias
   e historial sintético previo. Validar en iPhone físico antes de aprobar
   habilitación progresiva. Sin esos resultados no recomendar activar producción.

## Recuperación de fallos

- Red/respuesta perdida: mantener IndexedDB; reabrir con el mismo usuario y
  reconciliar mediante estado + RPC idempotente. No borrar datos del sitio.
- Conflicto: conservar borrador; adoptar terminal remoto únicamente tras
  confirmación del usuario. Nunca bajar cliente_v48 ni volver a upsert V47.
- Error de instalación en staging: detener el orden y revisar transacciones
  confirmadas. Restaurar el snapshot de staging si se requiere empezar de cero;
  no eliminar columnas ni comprobantes en una base con sesiones reales.
- Incidente posterior a una futura activación: detener nuevos inicios mediante
  el mecanismo 06 ya propuesto, conservar operaciones pendientes y corregir
  hacia adelante. No desactivar cuentas ni eliminar tablas para revertir.
