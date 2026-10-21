# VodaFit V48 — candidata local para revisión final

No publicada. No se ejecutó SQL, se accedió a Supabase, se activaron usuarios ni
se hizo commit/push/deploy durante esta consolidación. Producción sigue V47.1.1.

## Comparación y alcance

Se comparó el workspace real con E:\VodaFit-Staging\pwa\public. session/lifecycle/
reconcile coincidían exactamente. history sólo cambiaba el nombre del journal;
persistence cambiaba capacidades/nombre de IndexedDB. Las diferencias del HTML
eran configuración/banner de staging, dependencias locales y el cierre principal.

Se integró el cierre principal nativo probado en staging, con confirmación y hora
inmutable offline. V47 conserva Guardar entrenamiento como guardado de progreso.
No se copiaron URL/clave de staging, configuración, servidores, banners, bases
locales ni fixtures. Se conservaron EXACTAMENTE las constantes originales de
conexión de producción (clave publishable pública; no se imprimen en este informe).

Se trasladaron únicamente bibliotecas/fuentes estáticas de vendor, sin modificar
su código: Supabase JS 2.118.0 UMD (la versión que resolvía @2 al preparar staging),
jsPDF 2.5.1 y las mismas familias/pesos de fuentes. Licencias, origen y SHA256 en
vendor/DEPENDENCIAS.json. El shell deja de depender de CDN para recuperarse offline.

Se completaron dos omisiones demostrables del alcance aprobado:

- Cancelar una sesión nativa: confirmación y nativeReconciler.cancel, sin historial
  ni referencias realizadas. Offline conserva la intención terminal en el mismo
  borrador hasta confirmación; se recupera mediante el flujo existente.
- Calendario: duración medida/horas/zona y Ver series por identificador de sesión.
  Lectura paginada de registros vinculados, filtrada por profile_id y entreno_id;
  sin agrupar por fecha ni adivinar vínculos heredados. Dos sesiones del mismo día
  mantienen detalles separados. Histórico/manual: Sin duración medida.

No se tocaron Timer manual, mapa muscular, medios existentes ni datos históricos.
No se creó otro sistema de sesiones. El historial general por ejercicio sigue
utilizando registros; el detalle de calendario sólo lee sus vínculos reales.

La selección final incorpora explícitamente A1 (confirmar el guardado real de
registros antes de marcar series), A5 (contraste de series completadas mediante
success-on) y M1 (inputs de 16px para evitar zoom de Safari iOS). Son compatibles
con V48; no se crean implementaciones paralelas. Se mantienen sus regresiones
ya existentes en tests-v31. Esta inclusión fue autorizada al preparar el índice.

## Archivos de esta consolidación

- index.html: botón principal nativo, cancelar nativo, duración/detalle de sesión,
  imports locales, versiones de módulos y etiqueta visible V48 candidata en Perfil.
- v48-persistence.js: metadata/rpc=true para la candidata. **Esto exige esquema
  completo antes de publicar; NO activa cliente_v48 en ninguna cuenta.**
- sw.js: gymapp-v48-rc1, 23 entradas precache con cinco módulos/vendor/fuentes,
  scripts v=48.rc1; otros orígenes fuera de la interceptación. Supabase no se cachea.
- vendor/: dependencias locales/licencias/manifest de integridad.
- tests-v48.html, tests-v48ca.html, tests-v48cb.html, tests-v48history.html: casos de
  capacidades cerradas ahora inyectan explícitamente metadata/rpc=false, en lugar
  de exigir que TODA entrega siga deshabilitada. Siguen exigiendo cero RPC.
- tests-v31.html: la prueba de caché comprueba que se retiraron v6/v7/v8; no exige
  perpetuamente el literal v8. Se preservaron las ampliaciones preexistentes.
- Cinco tests-v48*-runner.cjs: interceptan también el SDK local, con el MISMO mock
  y bloqueo HTTPS de antes. Ningún test se conecta a producción.
- tests-v48rc-runner.cjs: UI real/worker con backend ficticio para cierre y cancelación
  offline, recuperación y calendario. validar-v48-rc.cjs: auditoría offline del paquete.
- supabase/v48/README.md y staging/v48/README.md: orden vigente y referencias a este
  informe, retirando como vigentes instrucciones históricas contradictorias.
- Este informe. No se modificó el cuerpo de ninguna migración durante esta tarea.

Los módulos/session/reconcile/history/lifecycle y los SQL ya estaban sin rastrear
al comenzar; siguen siendo archivos necesarios para la futura selección Git.
Había cambios de index/sw/tests-v31 y archivos ajenos antes de comenzar. Se
preservaron: el diff total contra HEAD NO representa sólo esta consolidación.
Backup de los archivos principales al inicio: E:\VodaFit-Staging\revision-final-original.
No se revirtió ni sobrescribió el trabajo de Claude y no se delegó trabajo paralelo.

## Validación realizada

Se ejecutaron individualmente los cinco runners existentes, todos con exit code 0.
El runner más amplio vuelve a ejecutar las suites previas; no sumar esos conteos
como casos únicos:

| Suite | Resultado |
| --- | --- |
| Persistencia A | 17/17 |
| Series B | 13/13 |
| Ciclo C-A | 16/16 |
| Cierre C-B | 32/32 |
| Manuales/historial | 36/36 |
| Regresiones V31 | 1072/1072 ejecuciones (536 casos, dos ejecuciones) |

También pasaron las comprobaciones extra de recarga real de los runners. Sin
errores JavaScript. Inicialmente las aserciones globales de capacidades cerradas
fallaron al habilitar la candidata; se mantuvo el escenario legacy mediante
inyección explícita en los tests, sin deshabilitar el producto para satisfacerlos.

Nuevo runner RC: tres recorridos aprobados, sin peticiones externas ni usuarios
reales. Cierre offline por botón principal con 10 kg ×12, cancelar confirmación no
cierra, hora congelada, inputs bloqueados, doble tap/reintentos, recarga offline,
reconexión, respuesta perdida después de COMMIT simulado, un único commit, sólo
series completadas y referencias aceptadas/rechazadas. Cancelación offline seguida
de recuperación produce un único comprobante cancelado simulado; sin referencias.
Calendario muestra duración, histórico sin medición y detalles separados por sesión.

validar-v48-rc.cjs: sintaxis JS, 23 assets presentes, cinco imports versionados,
hashes vendor, ausencia de configuración staging en runtime y coincidencia exacta
entre función corregida de 03 y parche 11. git diff --check sin errores.
No se ejecutaron pruebas SQL desde el agente ni se declara un nuevo parseo de
PostgreSQL: la evidencia SQL real es la informada por el usuario en staging.

Los logs completos de los cinco runners están en E:\VodaFit-Staging\rc-*.jsonl y
su resumen en rc-suites-resumen.json. Los tests usan Playwright de desarrollo ya
disponible en la PC; no se añadió un build system ni dependencia de Node a la PWA.

## Auditoría SQL y orden de publicación (acciones futuras)

Contrato: 13 firmas públicas, incluidas ambas v48_registro_guardar. Helpers privados
sin EXECUTE de clientes; nuevas RPC sensibles se crean/revocan en la misma
transacción. 04 otorga sólo authenticated, revoca permisos innecesarios y no activa
cuentas. Las RPC definer usan owner postgres/search_path vacío/auth.uid(), bloqueo
de rutina por usuario y revisión. FK compuesta impide series de otro usuario.
Los cierres finalizados/eliminados/cancelados conservan comprobantes terminales;
finalización/series/referencias/limpieza remota son una transacción.

03 fuente incluye v_peso/v_fecha. 09 conserva CAS y delega a esa función. 07 mantiene
firma/transacción y resuelve nombres con el mismo catálogo (prueba 08). No se detectó
necesidad de cambiar firmas, columnas, restricciones ni contratos aprobados.

1. **Punto de aprobación/backup.** Autorizar publicación por separado. Confirmar
   backup restaurable de producción, proyecto/actor correctos y PostgreSQL >=17.
   Revisar/seleccionar sólo archivos autorizados del workspace; muchos aún están
   sin rastrear y hay trabajo previo ajeno. No publicar todo el directorio a ciegas.
2. **Base de datos primero**, sobre producción V47 existente, sin activaciones:
   01_expansion → 02_rpc → 03_compatibilidad CORREGIDO → 07_cierre_canonico →
   09_compatibilidad_edicion → 04_activar_acceso. Una transacción por archivo,
   detener ante error; comprobar qué fases confirmaron antes de repetir.
   No instalar baseline V47, no ejecutar fixtures ni tests 05/08/10 en producción.
   11 NO es necesario porque 03 ya contiene su corrección. 06 no es instalación.
3. **Publicar aplicación compatible**, sólo después de confirmar el esquema:
   index.html, sw.js, manifest/iconos existentes, CINCO módulos v48-*.js, vendor
   completo y todos los medios existentes que usa la app. Conservar configuración
   productiva actual; nada de E:\...\pwa/private, servidores o datos de staging.
   Comprobar artefacto con node validar-v48-rc.cjs antes de publicar. La candidata
   tiene metadata/rpc=true; no existe fallback seguro a esquema ausente.
4. **Activar por usuario**, únicamente después de confirmar cliente V48 actualizado,
   con conexión, sin sesión heredada ni borrador/intención pendiente. Usar
   v48_activar(p_revision) con la revisión recién leída y la identidad de ESE usuario;
   nunca UPDATE de cliente_v48 ni activación masiva. Una cuenta no activada sigue
   usando flujo V47. El cliente publicado no activa cuentas automáticamente.
5. Registrar versión/fecha/hashes de archivos y migraciones efectivamente publicadas.
   Esto es control de publicación; no se pide repetir las pruebas manuales aprobadas.

## Reversión / contención

- Error durante un archivo SQL: ROLLBACK de esa transacción si sigue abortada;
  no saltar al siguiente ni reinstalar archivos ya confirmados. No DROP de tablas.
- Antes de activar cualquier usuario: puede volver la aplicación V47.1.1 dejando
  la expansión compatible instalada, con todos los cliente_v48=false. Retener
  columnas/comprobantes y evitar una migración inversa destructiva.
- Después de activar usuarios: NO volver a V47, NO bajar banderas por UPDATE,
  NO retirar guardas/columnas/tablas, NO borrar comprobantes ni vaciar storage.
  Contener nuevas activaciones/inicios mediante 06_contener_nuevos_inicios.sql
  (sólo bajo autorización operativa), conservando RPC de recuperación/cierre,
  cancelación/eliminación y la aplicación V48 compatible. Publicar corrección
  hacia adelante o volver únicamente a otra versión V48 compatible si ya existe.
  No hay hoy una versión V48 productiva anterior a la que prometer un rollback.
- Un rollback de UI debe tener nueva versión de caché para retirar el shell fallido,
  sin borrar IndexedDB/Auth ni cambiar UUID/timestamps de intentos pendientes.
- Restaurar un backup completo sólo ante recuperación de desastre revisada: puede
  perder escrituras posteriores. No es la reversión ordinaria de esta publicación.

## Riesgos y estado final

Preparada para revisión final; NO publicada ni activada para usuarios reales.
No quedan fallas automatizadas abiertas en las suites ejecutadas ni un cambio de
contrato DB requerido. La aprobación, backup y selección de cambios preexistentes
siguen siendo condiciones operativas antes de publicar, no tareas ejecutadas aquí.

La evidencia manual del usuario cubre inicio/series/referencias/duración, F5,
recuperación offline, cierre con hora congelada y sincronización única. Los nuevos
controles de cancelar/detalle y la candidata consolidada fueron verificados con
backend simulado, no con nuevas escrituras a staging ni producción.

No se ejecutaron dos conexiones PostgreSQL concurrentes nuevas ni pruebas HTTP
cruzadas entre JWT reales en esta consolidación. El bloqueo transaccional por
usuario se revisó en SQL y las carreras se cubren en los mocks; no se presenta
esa cobertura como una prueba de carga/concurrencia real del servicio alojado.

Límites conservados: conflictos de revisión/ramas locales bloquean sobrescritura
automática; requieren resolución explícita. La idempotencia terminal es de sesiones
nativas. Altas manuales tienen UUID estable pero NO tombstone remoto: un replay
antiguo después de borrar manualmente su fila puede recrearla; no se promete el
contrato terminal de sesiones para ese flujo legado. No se amplió el esquema para
resolverlo en esta consolidación. Referencias aceptadas sobreviven al borrar una
sesión; el historial heredado permanece sin conversión ni duración inventada.
