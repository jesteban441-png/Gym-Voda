# V48 — Compatibilidad de registros manuales e historial

Implementación local. No se ejecutó SQL, se accedió a Supabase, se activaron
cuentas ni se hizo commit/push/deploy. Capacidades de producción continúan false.

## Archivos de esta tarea

Modificados: index.html y sw.js.
Nuevos: v48-history.js, tests-v48history.html, tests-v48history-runner.cjs,
este documento y los SQL propuestos:

- supabase/v48/09_compatibilidad_edicion.sql
- supabase/v48/10_pruebas_compatibilidad.sql

Los módulos, SQL, tests y documentos no rastreados que ya existían NO se editaron.
Los informes anteriores de staging son snapshots de etapas anteriores; su bloqueo
M1 queda resuelto en el cliente por esta entrega, pendiente de validación real.
Su orden/count de firmas debe leerse con la actualización de este documento.

## Rutas adaptadas

| Operación | V47 no activado | V48 activado, esquema/capacidades disponibles |
| --- | --- | --- |
| Store.addRegistro | INSERT registros | v48_registro_guardar con p_editar=false, p_esperado=null |
| Store.updateRegistro | UPDATE propietario/id | v48_registro_guardar con p_editar=true y snapshot p_esperado |
| Store.deleteRegistro | DELETE propietario/id | v48_registro_eliminar |
| Store.addEntreno manual | INSERT entrenos, is_manual | v48_marcar_dia |
| Store.deleteEntreno heredado/manual | DELETE resumen propietario/id | v48_historico_eliminar |
| Sesión nativa completa | No se convierte ni usa el camino heredado | Mantiene v48_eliminar y comprobante de C-B |

La activación se decide desde los metadatos cargados de la cuenta. Sin capacidades
metadata/rpc y schemaReady no se consultan columnas nuevas ni se prueban RPC.
No hay fallback a DML si la cuenta está activada o falla una RPC. Si el servidor
activa una cuenta después de la lectura de un cliente antiguo, sus guardas siguen
rechazando el DML: no se interpreta como éxito ni se fuerza sobrescritura.

## Datos e integridad

- UUID de alta estable por operación; respuestas UUID se comprueban contra el
  solicitado. Una RPC void sólo se confirma con respuesta exitosa null (incluye
  HTTP vacío/204 normalizado); errores, respuestas inválidas y permisos denegados
  nunca se presentan como guardados/eliminados.
- Altas nuevas usan canonicalExerciseName. Al EDITAR se relee el registro crudo
  del propietario: se mantiene su exercise original, created_at y set_number.
  No se normaliza masivamente historial ni se escribe otra identidad por leerla
  canónica en pantalla. Sólo cambian los campos explícitamente editados.
- Registros con entreno_id no se modifican ni eliminan individualmente: se informa
  que debe eliminarse la sesión nativa completa. El servidor también lo impide.
- Eliminar un resumen heredado sólo elimina ese resumen; conserva registros sin
  vínculo. Eliminar sesión nativa conserva el flujo transaccional/comprobante de
  C-B y elimina sus series vinculadas, sin convertir filas previas.
- Guardado manual no actualiza referencias de ejercicios, rutina ni duración.
  Marcar un día no inventa series ni lo presenta como sesión cronometrada.

## Reintentos y aislamiento

v48-history.js contiene un journal pequeño de operaciones de historial en
IndexedDB `vodafit-history-intents`. Cada clave incluye propietario y canal; no
almacena tokens/credenciales ni crea otra sesión de entrenamiento. No escribe en
el borrador de rutina de A ni interfiere con su CAS de sesiones activas.

Se persiste UUID/request antes de enviar. Un resultado incierto conserva el
intento y no permite reemplazarlo silenciosamente por otro contenido. Antes de
reintentar se consulta la fila por propietario/id: si el servidor ya contiene el
destino esperado se reconoce sin INSERT/UPDATE adicional. Estados confirmados se
retienen hasta releer historial; una relectura fallida no repite la escritura.
Otro contexto que confirme y libere el journal no hace que el intento viejo genere
otro UUID mientras siga abierto. Tras recarga se recupera el intento durable;
el formulario V48 restaura los datos pendientes sin pisar lo que ya se escribió
mientras esperaba IndexedDB.

La nueva edición envía snapshot original y conserva el esperado en reintentos.
Si cambió la fila se devuelve HISTORY_CONFLICT, no se lee la versión nueva para
sobrescribirla con una aceptación inventada. Un conflicto de alta puede resolverse
con confirmación explícita para usar la fila remota; no se modifica el servidor.

Todos los handlers capturan propietario/generación; después de await vuelven a
comprobarlos antes de modificar estado, cerrar formularios o mostrar éxito. Se
limpia selección/filtro de historial al cambiar cuenta. Un resultado de A no
actualiza B. Sin IndexedDB operativo V48 falla antes de enviar una nueva escritura;
V47 mantiene su camino anterior sin exigir ese journal.

V47 conserva DML y no requiere esquema V48. Los formularios actuales añaden un
UUID cuando está disponible; un reintento del MISMO formulario tras un INSERT ya
realizado compara su fila ante 23505, sin upsert. Si el guardado fue confirmado y
la recarga de historial falla, tampoco vuelven a insertarlo. Clientes V47 antiguos
y una recarga que abandone un formulario legado sin confirmación no adquieren
comprobantes terminales: no se promete exactamente una ejecución distribuida para
esos clientes. No se cambiaron tablas ni la arquitectura V47 para simularlo.

Los registros manuales usan la idempotencia por ID de 03; no tienen los
comprobantes terminales de sesiones. Un reintento de alta antigua después de que
su fila haya sido eliminada en otro dispositivo no dispone de tombstone remoto.
No se equipara ese contrato con la protección terminal del cierre nativo.

## UI y errores corregidos

- Registro manual: error conserva campos y rehabilita botón; no reemplaza la
  pantalla como si hubiese guardado. Confirmado + fallo de recarga se informa por
  separado. No se crea otra operación al pulsar reintentar sin refrescar.
- Registro por serie heredado: si falla no se escribe registroId ni se marca la
  serie. Si un alta ya confirmó, un fallo posterior de lectura/persistencia no
  vuelve a crear la misma serie en el siguiente intento del modal.
- Marcado manual del calendario: comprueba ok antes de cerrar o mostrar éxito.
- Borrado de registros/resúmenes: comprueba respuesta y propietario antes de quitar
  filas. El error mantiene datos. Para los borrados void repetir una fila ya ausente
  es idempotente; no implica haber borrado una fila de otro usuario.
- Sin rediseño visual. Sólo mensajes de fallo y diálogo de resolución de conflicto.

## Corrección SQL mínima (no ejecutada)

03 soporta los campos de la operación existente, pero la edición original no
lleva versión/esperado. 09 añade UNA SOBRECARGA:

`v48_registro_guardar(p_id uuid,p_datos jsonb,p_editar boolean,p_esperado jsonb)`

Devuelve el mismo UUID. p_esperado no tiene DEFAULT, evitando ambigüedad con la
firma previa de tres argumentos. Para altas delega validación/escritura a 03;
para edición bloquea la fila propia y compara la instantánea exacta. Si ya está
exactamente en el destino solicitado reconoce el reintento; si cambió a otro
contenido lanza 40001/HISTORY_CONFLICT. Valida datos incluso en el caso idempotente.
Reutiliza el bloqueo por usuario y la escritura de 03; no añade columnas/tablas ni
reescribe filas existentes. Security definer, owner postgres, search_path vacío,
objetos calificados; revoca EXECUTE de PUBLIC/anon/authenticated/service_role.
Después 04 otorga sólo authenticated a esta firma junto con las demás.

La firma previa permanece compatible. No se cambian las RPC de finalizar,
cancelar o eliminar sesión. El cliente NO vuelve a usar la firma antigua para
editar si falta 09: presenta el error y conserva el intento.

## Actualización del orden de staging

Actualizar la COPIA aislada de staging con el index.html y sw.js de esta entrega
y copiar también **v48-history.js**. La lista anterior de cuatro módulos ahora
requiere cinco; un clone/archive sólo de archivos rastreados no incluye estos
módulos locales. Cambiar URL/clave/capacidades sólo en esa copia según la guía,
nunca en el workspace productivo. Las capacidades del origen siguen false.

Baseline V47 → 01 → 02 → 03 → 07 → **09_compatibilidad_edicion** → 04.
Después: control de metadatos de staging, 05 → 08 → **10_pruebas_compatibilidad**.
06 continúa fuera del orden normal (contención). No ejecutar glob alfabético.

El control staging/v48/09_verificar_instalacion.sql sigue siendo de LECTURA; no
confundirlo con el nuevo supabase/v48/09_compatibilidad_edicion.sql que define la
sobrecarga. En el control ahora se esperan **13 firmas públicas / 12 nombres**,
no 12 firmas. Los demás requisitos de grants/RLS/FK se mantienen.

10 termina ROLLBACK y requiere, igual que 05, dos perfiles Auth sintéticos
existentes sin rutinas/registros/entrenos. Pegar sus SELECT set_config A/B dentro
del BEGIN, antes del DO. Ejecutarlo DESPUÉS de 05/08 y ANTES de cargar la fixture
persistente del cliente. Verifica altas/replay, edición preservando metadatos,
40001, borrado heredado, guardas de series nativas, aislamiento entre usuarios,
borrado completo nativo y privilegios de la sobrecarga. Espera NOTICE
`V48 compat smoke: OK; se revierte todo`. No se ejecutó aquí.

Para RPC por HTTP en staging probar explícitamente los CUATRO argumentos; confirmar
que PostgREST resuelve la nueva firma y que no admite EXECUTE de anon/PUBLIC.
Repetir con dos dispositivos editando el mismo esperado: sólo uno puede cambiar
hacia un destino diferente, el segundo debe fallar sin perder el suyo. Repetir
respuesta perdida y valores rechazados; no habilitar producción antes de esto.
Los informes/CSV previos de staging son históricos: M1 ya debe probar las cinco
rutas nuevas, no conservar la etiqueta de bloqueo estático como conclusión actual.

## Validación local

Runner nuevo tests-v48history-runner.cjs, Node/Playwright de desarrollo, canal
msedge. Intercepta HTTPS y bloquea service workers en contextos aislados; no accede
a Supabase real ni habilita cuentas. Incluye las suites existentes sin editarlas.

- Historial: 36/36, más recarga REAL tras respuesta perdida y mismo UUID.
- C-B: 32/32; C-A: 16/16; B: 13/13; A: 17/17.
- V31 actual: 1072/1072 ejecuciones (536 casos, dos ejecuciones por el harness).
  Incluye nueve casos añadidos concurrentemente a tests-v31.html por otra edición;
  esta tarea no modificó ni revirtió ese archivo. Las 1054 ejecuciones originales
  habían pasado también antes de aparecer esa ampliación.
- Sin errores JS. Sintaxis JS y SQL comprobada offline; parsear SQL NO ejecuta
  migraciones ni verifica semántica/privilegios del servidor real.

## Operaciones que siguen restringidas intencionalmente

- Editar/borrar una serie de sesión nativa individualmente: inmutable; borrar
  la sesión completa con su RPC y confirmación.
- Escribir un cierre heredado como si fuera nativo o activar con una sesión
  heredada viva: rechazado; terminarla primero por el flujo legado.
- Esquema/capacidades no desplegados, permisos insuficientes, conflicto o storage
  local fallido: se conserva el intento y no se anuncia éxito. SQL09 ausente
  también bloquea manuales V48 hasta completar el paquete.

No queda una de las cinco operaciones manuales normales usando DML en una cuenta
V48 activada. Las escrituras DML de profiles/peso_corporal son ajenas a los tres
triggers y permanecen sin modificaciones. Verificar realmente permisos, RPC,
RLS y concurrencia en staging es lo pendiente; esta entrega no autoriza activación.
