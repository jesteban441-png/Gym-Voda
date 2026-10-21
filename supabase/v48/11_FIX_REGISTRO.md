# Corrección de ambigüedad 42702 en staging

No se ejecutó SQL. No se modificó producción ni staging desde el agente.

## Diagnóstico

03 declaraba una variable `peso` y luego ejecutaba `UPDATE ... SET peso=peso`.
El identificador derecho podía ser columna o variable; PostgreSQL con su política
normal `plpgsql.variable_conflict=error` rechaza preparar esa sentencia. CREATE
FUNCTION no detecta necesariamente esta ambigüedad SQL hasta ejecutar la rama.
No es un fallo de RLS, grants, payload del cliente ni comparación CAS.

09 no declara `peso`: verifica snapshot, bloquea la fila y delega el UPDATE en la
firma de 03. Por eso ambas aparecen en el stack. No requiere reemplazo.
En 03/09 no se encontraron otras colisiones iguales: parámetros tienen prefijo
p_, registros r/viejo se acceden por campo y actual no coincide con columnas.
Se renombra además fecha a v_fecha por consistencia (la columna real es date).
No se cambia variable_conflict ni se oculta el error usando una preferencia global.

## Cambios

- 03_compatibilidad.sql: variables v_peso/v_fecha, misma firma y lógica.
- 11_fix_registro_guardar.sql: reemplaza exclusivamente la firma de tres argumentos
  ya instalada, dentro de transacción, verificando existencia/contrato básico.
  Conserva DEFAULT false, RETURNS uuid, SECURITY DEFINER y search_path vacío.
  CREATE OR REPLACE conserva OID, owner, ACL y las dependencias de 09. No altera
  tablas, políticas, triggers, referencias ni series/sesiones.
- 10_pruebas_compatibilidad.sql: regresión explícita de UPDATE por firma de tres
  argumentos, cambiando peso/fecha y volviendo a peso cero; mantiene la prueba CAS
  por firma de cuatro argumentos, reintento, conflicto, historia y aislamiento.

## Aplicación manual, un paso por vez

1. Confirmar que SQL Editor está en **vodafit-staging** con rol postgres. Si quedó
   una transacción abortada del test, ejecutar manualmente ROLLBACK antes del parche.
   El test fallido no confirma sus cambios; no borrar usuarios/perfiles ni datos.
2. Abrir 11_fix_registro_guardar.sql y ejecutar su contenido COMPLETO como postgres
   en una consulta nueva. Esperado: Success. No rows returned. No ejecutar otra
   vez 03, 09 o 04: sus CREATE FUNCTION no están diseñados para reinstalación.
3. Ante error, detener, ejecutar ROLLBACK si la sesión quedó abortada y conservar
   el mensaje. La transacción restaura la definición previa si el parche falla.
4. Abrir la versión ACTUALIZADA de 10_pruebas_compatibilidad.sql. En el espacio
   indicado, DESPUÉS de BEGIN y ANTES del primer DO, insertar:

   ```sql
   SELECT set_config('v48.test_a','UUID_REAL_DE_A_EN_STAGING',true);
   SELECT set_config('v48.test_b','UUID_REAL_DE_B_EN_STAGING',true);
   ```

   Reemplazar placeholders con los dos UUID sintéticos ya creados; no contraseñas.
   Ejecutar TODO el archivo junto. No ejecutar esos SELECT en otra transacción.
   A/B requieren profiles existentes y ninguna fila propia en rutinas, registros
   o entrenos. Si esa precondición falla, detener y revisar; no borrar a ciegas.
5. Esperado: NOTICE `V48 compat smoke: OK; se revierte todo`, sin errores, y
   ROLLBACK al final. Los usuarios/perfiles permanecen; fixtures, activaciones y
   cambios de la prueba no. Un ROLLBACK tras error no significa test aprobado.

El parche no comprueba automáticamente la identidad del proyecto: revisarla en
Dashboard es indispensable. Las pruebas SQL no sustituyen Auth/REST ni concurrencia
reales. No se afirma que el test pase hasta ejecutarlo manualmente en staging.
