# V48 — selección explícita para commit (sin commit ni publicación)

Base esperada: 961c108cb3fb7e38874d02d95a5c18c6675d3b23 (V47.1.1).
La autorización de esta etapa incluye A1, A5 y M1. Tras revisar el diff completo,
index.html y tests-v31.html no requieren separación adicional de hunks: V48 y esas
tres mejoras aprobadas son el alcance. A5 conserva el contraste mediante success-on;
M1 conserva inputs de 16px; A1 confirma escritura antes de marcar y no se duplica.

## Archivos seleccionados (lista cerrada)

```text
.gitattributes
.vercelignore
index.html
sw.js
tests-v31.html
v48-persistence.js
v48-session.js
v48-lifecycle.js
v48-reconcile.js
v48-history.js
tests-v48.html
tests-v48b.html
tests-v48ca.html
tests-v48cb.html
tests-v48history.html
tests-v48-runner.cjs
tests-v48b-runner.cjs
tests-v48ca-runner.cjs
tests-v48cb-runner.cjs
tests-v48history-runner.cjs
tests-v48rc-runner.cjs
validar-v48-rc.cjs
verificar-paquete-v48.cjs
V48_1A_PERSISTENCIA.md
V48_1B_SERIES.md
V48_1C_A_CICLO.md
V48_1C_B_CIERRE.md
V48_COMPAT_HISTORIAL.md
V48_CANDIDATA.md
V48_SELECCION.md
supabase/v48/01_expansion.sql
supabase/v48/02_rpc.sql
supabase/v48/03_compatibilidad.sql
supabase/v48/04_activar_acceso.sql
supabase/v48/05_pruebas_staging.sql
supabase/v48/06_contener_nuevos_inicios.sql
supabase/v48/07_cierre_canonico.sql
supabase/v48/08_pruebas_canonicas.sql
supabase/v48/09_compatibilidad_edicion.sql
supabase/v48/10_pruebas_compatibilidad.sql
supabase/v48/11_fix_registro_guardar.sql
supabase/v48/11_FIX_REGISTRO.md
supabase/v48/README.md
supabase/v48/validar_sintaxis.py
vendor/DEPENDENCIAS.json
vendor/fonts/fonts.css
vendor/fonts/font-1.ttf
vendor/fonts/font-2.ttf
vendor/fonts/font-3.ttf
vendor/fonts/font-4.ttf
vendor/fonts/font-5.ttf
vendor/fonts/font-6.ttf
vendor/fonts/font-7.ttf
vendor/fonts/OFL-BarlowCondensed.txt
vendor/fonts/OFL-WorkSans.txt
vendor/jspdf-2.5.1/jspdf.umd.min.js
vendor/jspdf-2.5.1/jspdf.umd.min.js.map
vendor/jspdf-2.5.1/LICENSE
vendor/supabase-js-2.118.0/supabase.js
vendor/supabase-js-2.118.0/LICENSE
```

Son 60 rutas de cambio, incluidos este manifiesto, .gitattributes y .vercelignore. La selección
NO equivale a copiar todo el workspace. Los archivos rastreados de V47 no tocados
(manifest, iconos, medios, etc.) permanecen en el árbol resultante automáticamente.
No hay eliminaciones. Las migraciones viejas ya rastreadas no cambian; no se añaden
migraciones históricas nuevas ni se ejecutan las de V48.

## Fuera de esta selección; conservado sin cambios

- Ejecucion correcta/, Recetas nutricion/, Rutinas y estiramientos/: PDFs ajenos.
- VF logo.png; integracion-anatomia.html; prototipo-anatomia.html; pruebas-tamano.html.
- ejercicios/anatomia/curl-biceps-anatomia.jpeg,
  ejercicios/anatomia/curl-inclinado-anatomia.jpeg,
  ejercicios/anatomia/plancha-anatomia.png: no los utiliza el runtime seleccionado.
- supabase-migration-v35.sql; docs/ (auditoría ajena y propuestas históricas).
- staging/ completo: baseline, consultas de preparación, fixtures y actas locales.
  Las menciones de staging de informes previos son contexto histórico, no archivos
  que deban publicarse o instrucciones para producción.
- E:\VodaFit-Staging\pwa/private y toda la copia aislada están fuera del repo.

## Exclusiones de despliegue

.vercelignore usa la allowlist oficial de Vercel: ignora la raíz y permite sólo
index/sw/manifest/iconos, CINCO módulos y vendor/ejercicios. También excluye
explícitamente los tres medios ajenos, para no subirlos desde un workspace sucio.
Documentación, SQL, pruebas, runners, fixtures, herramientas, PDFs y prototipos
no son contenido de la web. Las licencias de vendor se conservan junto al código.
No se cambia la configuración productiva, el output directory remoto ni el backend.

.gitattributes conserva los bytes de vendor sin conversión LF/CRLF. Sólo allí
omite el chequeo de whitespace original de terceros; los SHA256 siguen siendo
obligatorios. No se editan los bundles para limpiar espacios ni se ocultan avisos
del código propio. Esto permite reproducir su integridad con core.autocrlf=true.

Referencia: https://vercel.com/docs/deployments/vercel-ignore

verificar-paquete-v48.cjs utiliza el motor git check-ignore sobre .vercelignore,
en un repositorio temporal separado del índice principal. Verifica precache,
imports, iconos, CSS/fuentes y todos los medios existentes del catálogo; detecta
recursos ausentes/excluidos y posibles secretos/configuración de staging.
Puede exportar un artefacto filtrado con --export DESTINO_NUEVO, fuera del checkout.
No hace deploy ni conecta a Vercel/Supabase. La evaluación local no pretende
certificar ajustes remotos del proyecto Vercel que no se consultaron.

## Reproducción y pruebas sobre el índice

La validación debe hacerse sobre una exportación NUEVA de git checkout-index,
no copiando el workspace. Comparar lista de rutas staged con la lista anterior,
verificar hashes de archivos contra git show :ruta y ejecutar allí:

```text
node validar-v48-rc.cjs
node verificar-paquete-v48.cjs --export DESTINO_RUNTIME_NUEVO
node tests-v48-runner.cjs
node tests-v48b-runner.cjs
node tests-v48ca-runner.cjs
node tests-v48cb-runner.cjs
node tests-v48history-runner.cjs
node tests-v48rc-runner.cjs
```

Repetir el último runner con V48_PUBLIC_ROOT apuntando al artefacto filtrado:
así la UI, el service worker y la recuperación offline no pueden cargar archivos
excluidos. Los otros runners requieren sus HTML/SQL de test del checkout, por eso
no se ejecutan desde el directorio público filtrado.

Herramientas de esta PC: Node 24.19.0, Git, Playwright 1.62.1 y navegador Edge
instalado. Los cinco runners admiten V48_BROWSER_CHANNEL=msedge; el runner RC usa
Edge. NODE_PATH puede apuntar a una instalación EXTERNA de Playwright 1.62.1.
No se introduce framework, build system, node_modules o secretos en el repo.
Un checkout limpio contiene todo el runtime y tests; necesita esas herramientas
de desarrollo para ejecutar los runners, no para servir la PWA estática.

No ejecutar todos los SQL por orden alfabético: la instalación futura sigue
01 → 02 → 03 corregido → 07 → 09 → 04. 05/08/10 son tests; 06 contención; 11 es
parche de instalaciones anteriores y no hace falta con el 03 corregido.

Esta etapa sólo prepara el índice. La autorización de commit, push, migraciones,
deploy y activación de usuarios permanece separada.
