# V48 — paquete SQL revisable

Preparado localmente; producción NO ejecutada por el agente. Staging instalado y
pruebas aprobadas según el usuario. No instalar en producción sin aprobación.
PostgreSQL objetivo 17.6 / Supabase, owner SQL Editor postgres.
Diseño y publicación vigentes: ../../V48_CANDIDATA.md.

## Orden definitivo de la candidata V48

Revisado tras integración real de staging y parche 11. Informe vigente:
[../../V48_CANDIDATA.md](../../V48_CANDIDATA.md). Nada se ejecuta automáticamente.

**Producción V47 existente: 01 → 02 → 03 corregido → 07 → 09 → 04.**
Una transacción completa por archivo, como postgres; detener ante cualquier error.
No instalar baseline_v47.sql en producción: las cinco tablas ya existen.
No ejecutar 05, 08 ni 10 en producción: son pruebas de staging.
No ejecutar 06 salvo contención explícita de un incidente.

03 contiene v_peso/v_fecha, misma corrección que 11. El parche 11 se utiliza
sólo para una instalación que YA tenía el cuerpo defectuoso; no hace falta en
una instalación nueva con el 03 corregido. No repetir 03/07/09 después de 04
sobre cuentas activadas: CREATE puede fallar y 07/09 revocan permisos.

1. Backup restaurable y revisión de esquema/actor/proyecto antes de producción.
2. Instalar/verificar las seis fases anteriores sin activar ninguna cuenta.
   Las guardas conservan upsert/DML V47 para cliente_v48=false. 04 sólo concede
   EXECUTE a authenticated y retira permisos no usados; no retira DML legado.
3. Publicar cliente candidato V48 con los cinco módulos y vendor local, caché
   gymapp-v48-rc1 y metadata/rpc=true. **No publicar antes del esquema completo.**
4. Activar cuentas individualmente mediante v48_activar(revisión vigente), sólo
   con cliente actualizado, sin sesión heredada ni borrador pendiente.
   Nunca UPDATE directo/masivo de cliente_v48. No hay activación automática.

En staging se aprobaron 05 y 10 según el usuario; 08 terminó sin errores y se
aplicó 11. Además se aprobaron las pruebas manuales principales de sesión online,
recuperación, cierre offline y sincronización sin duplicación. Esas evidencias
no significan que se haya ejecutado el paquete en producción.

Rollback: antes de activar puede volver el cliente V47 manteniendo la expansión.
Después de activar usar contención 06 y mantener cliente V48 compatible; no bajar
banderas, retirar guardas, borrar comprobantes ni restaurar cliente V47.

## Pruebas bloqueantes de producción

05 es un smoke test transaccional y termina ROLLBACK; no sustituye las siguientes:

- Antes/después: comparar snapshot de columnas/filas históricas sintéticas; sin
  cambios de valores, filas ni set_number. Comprobar defaults y RLS existentes.
- V47: upsert de rutina y DML de registros/entrenos siguen funcionando antes de
  activar; sesión heredada impide activación sin descartar contenido. Finalizarla
  con flujo legado, activar después; ningún INSERT de conversión.
- Identidad: dos usuarios/anon; no leer, finalizar, borrar ni vincular filas ajenas.
  Probar FK cruzada con un actor de staging capaz de insertar saltando guardas:
  PostgreSQL debe rechazar la relación, aun con owner BYPASSRLS.
- Grants: nuevas funciones sin EXECUTE de PUBLIC/anon; solo authenticated en 04;
  ningún DML de comprobantes; helpers privados inaccesibles; search_path vacío,
  owner postgres y revisión de cada predicado de usuario.
- Dos conexiones, misma revisión: guardar rutinas/sesión diferentes, una acepta y
  otra REVISION_CONFLICT. Guardar contenido idéntico permite reintento sin incremento.
- Dos cierres idénticos simultáneos: un entreno, N series, un comprobante. Payload
  distinto/revisión vieja: conflicto sin modificar cierre. Simular respuesta perdida
  después de COMMIT y repetir; el resultado debe identificar el mismo entreno.
- Finalizar contra cancelar/eliminar simultáneos: bloqueo por usuario, un estado
  terminal, sin resurrección ni serie huérfana. Eliminar repetido no borra nada extra.
- Inyectar fallo en staging después de INSERT entrenos, INSERT series y UPDATE rutina;
  verificar rollback integral, incluida revisión y referencias. No modificar código
  de producción para inyectar fallos. Revisar timeout/deadlock y conservar payload.
- Valores NULL, cero, negativos, NaN/Infinity, reps rangos/texto/desbordamiento,
  duplicación de instancia/serie, referencias obsoletas y nombre repetido conflictivo.
- No guardar referencia conserva la previa y guarda series realizadas. Cancelar
  conserva referencia previa. Borrar sesión conserva referencia aceptada.
- Más de una sesión por fecha, medianoche, zona local, móvil cerrado, fin offline,
  rechazo de reloj futuro >60s. Duración no editable; inicio no se modifica en guardados.
- Copias viejas/tabs: no pueden borrar bandera, bajar revisión ni sobrescribir
  borrador V48; V47 no recibe falsos guardados exitosos desde el cliente nuevo.
- Registro manual, marcado de calendario, borrado de histórico, exportaciones,
  métricas, estiramientos y Timer intactos en pruebas del cliente.

Validación estática realizada con pglast 8.6: se analizaron sintaxis SQL y cuerpos
PL/pgSQL, sin conexión ni ejecución. No comprueba resolución de tipos/objetos ni
comportamiento de permisos. No se ejecutaron estas pruebas contra PostgreSQL.

## Recuperación sin pérdida

ANTES de activar cuentas: una fase fallida revierte sola; no es necesario DROP de
datos. Si 04 falla, su transacción también revierte grants. Corregir en staging.

DESPUÉS de activar: usar 06 para detener nuevas activaciones/inicios manteniendo
guardar/finalizar/cancelar de sesiones existentes y lectura. Guardar copia local de
payload/revisión. Reintentar el mismo sessionId; nunca generar otro UUID tras timeout.
Consultar v48_estado(sessionId) para diferenciar finalizada/eliminada/cancelada.

No volver a V47 ni poner cliente_v48=false en cuentas migradas: permitiría que una
copia antigua eliminara claves nuevas. No borrar columnas, comprobantes, triggers o
funciones. Resolver con corrección hacia adelante y reabrir permisos solo después
de repetir pruebas. Backup/PITR es último recurso coordinado: una restauración global
puede perder otros cambios posteriores y exige reconciliación, no es un rollback SQL.

Errores inesperados conservan borrador local/remoto y muestran pendiente; nunca
afirmar que el cierre se guardó sin comprobante. RPC bajo postgres no implica uso
de credenciales service-role en cliente: el navegador usa sesión Auth normal.
