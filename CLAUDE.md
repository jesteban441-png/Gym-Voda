# VodaFit — memoria permanente

Hechos técnicos y decisiones cerradas. `AGENTS.md` tiene las reglas de proceso. **El código es la fuente de verdad**: si algo de acá no coincide, corregí este archivo. Los inventarios exactos (cuántos ejercicios, qué pools, qué aliases) se consultan en el código, no acá.

---

## 1. Arquitectura

PWA estática, sin framework y sin build system. Backend: **Supabase** (Auth + Postgres + RLS) consumido **desde el cliente** — no hay backend propio ni serverless. Repo en GitHub, deploy en Vercel. **No introducir** framework, bundler, backend, serverless ni dependencias nuevas sin aprobación explícita.

| Archivo | Qué es | EOL |
|---|---|---|
| `index.html` | **toda la app** (~514 KB): CSS, markup y JS | **CRLF** |
| `sw.js` / `manifest.json` | Service Worker / manifest PWA | LF |
| `tests-v31.html` | harness de tests (iframe + `window.__appTest`) | LF |
| `baseline-clasificacion.js` | línea base de clasificación (§6) | LF |
| `ejercicios/anatomia/*` | láminas anatómicas | — |
| `supabase-migration-v*.sql` | migraciones versionadas | LF |

**Trampa de saltos de línea:** `index.html` usa **CRLF**. Un parche con `perl`/`sed` tiene que machear `\r\n` y convertir el contenido insertado (`s/\n/\r\n/g`), o falla **en silencio** sin cambiar nada. Verificar después de editar (`file index.html`).

**Navegación:** `state.tab` es el único selector de pantalla — `rutina`, `registro`, `timer`, `perfil`, más tres sin pestaña propia (`explorar`, `exdetail`, `mapa`) que se abren con topbar y botón de volver. `setTab()` es el único embudo. `render()` → `renderScreen()` → `screen*()` → `afterScreenMount()`.

**Service Worker:** `CACHE = "gymapp-v7"`. No-GET pasa derecho; navegación network-first con fallback al `index.html` cacheado; el resto cache-first con refresh en segundo plano. **Supabase se excluye por ORIGEN**, no por lista de endpoints: `isSupabaseUrl()` corta con un `return` seco **antes** de tocar Cache Storage. No agregar una estrategia de caché para Supabase.

### Convenciones de Supabase (obligatorias)

Tablas: `profiles`, `rutinas`, `registros`, `entrenos`, `peso_corporal`. Nombres en español, `snake_case`.

- `profile_id uuid` → `profiles(id)`, que **es** `auth.uid()`.
- `created_at` / `updated_at` son **BIGINT epoch en MILISEGUNDOS** (`Date.now()`), nunca `timestamptz`.
- La fecha del dato va en una **columna propia** `date` (`registros.date`, `peso_corporal.fecha`), separada de `created_at`.
- **No hay `unique(profile_id, fecha)` en `peso_corporal`**, a propósito: pesarse dos veces el mismo día es legítimo. El "actual" se resuelve por `fecha desc, created_at desc`.
- Ventanas de lectura: `registros`, `entrenos` y `peso_corporal` 1000. El diagnóstico de identidad usa su propia ventana de 5000 y no se toca.
- Todo cambio de schema necesita una **migración versionada** en el repo. **Nunca ejecutar SQL automáticamente**: se entrega el archivo y lo corre Juan.

---

## 2. Reglas permanentes de desarrollo

1. **Inspeccionar antes de modificar.** El repo es la fuente de verdad.
2. **Reusar lo que existe** antes de crear un sistema paralelo. Hay funciones para casi todo: buscá antes de escribir.
3. **No cambiar comportamiento establecido para que pase un test viejo.** Si un test refleja una decisión que cambió, se **actualiza el test con su justificación escrita**, nunca se afloja la aserción.
4. **No inventar** ejercicios, mapeos de media, URLs, columnas ni requisitos. Si un dato no se puede verificar, decir **NO VERIFICADO**.
5. **Un cambio de alcance se avisa, no se decide solo.** Si aparece una decisión que pertenece a otra etapa, se documenta y se sigue con lo acordado.
6. Preservar responsive mobile y la identidad visual.
7. No romper el Timer ni las vueltas salvo pedido explícito.
8. No exponer secretos de service-role en el cliente.
9. **No borrar media de ejercicios sin aprobación explícita.**

---

## 3. Catálogo

Un ejercicio **es un string**: su nombre canónico. No existe un objeto "ejercicio"; toda su información vive en diccionarios paralelos indexados por ese nombre (`EXERCISES`, `MUSCLE_MAP`, `EXERCISE_ALIASES`, `EXERCISE_PATTERN`, `EXERCISE_TIPS`, `EXERCISE_HOWTO_LINKS`, `EXERCISE_EQUIPMENT`, `EXERCISE_ANATOMY_IMAGES`, `EXERCISES_COMPOUND`, `EXERCISES_RISKY_50PLUS`). **Agregar un ejercicio implica tocar hasta 9 lugares** y no hay validación que avise si falta uno; los tests de la baseline (§6) cubren parte de eso.

Equipamiento — **7 valores cerrados**: `Barra`, `Cardio`, `Mancuernas`, `Máquina`, `Peso corporal`, `Peso libre`, `Polea`. No agregar un octavo sin decisión; en particular no reintroducir "Mancuerna" en singular.

- `activeExercises()` es la **única puerta de entrada** al catálogo oficial. Hoy **no filtra nada** — `EXERCISES` ya es el catálogo activo. Existe para marcar la frontera con los personalizados, no porque haga falta un filtro.
- **La categoría "retirados" no existe.** `EXERCISES_RETIRED` e `isRetiredExercise()` fueron eliminados y los retirados se borraron de verdad de todas las tablas. **No restaurarlos ni recrear compatibilidad histórica.** Si hay que retirar otro: **se borra de las tablas**, no se agrega un filtro.
- `Hip thrust con barra` (el genérico `Hip thrust` era, sin ambigüedad, el de barra) comparte `EXERCISE_PATTERN = "extension-cadera"` con `Hip thrust en máquina` y `Puente de glúteos`, para que el generador no ofrezca dos el mismo día. Sigue siendo un ejercicio **distinto** del de máquina.

**Identidad:** `canonicalExerciseName(nombre)` consulta primero `EXERCISE_ALIASES` (explícito) y si no `resolveExerciseNameNormalized()` (minúsculas, sin tildes, sin stopwords). Un nombre desconocido **se devuelve tal cual** — eso es lo que permite el alta manual. Invariantes vigentes: ninguna clave de alias es a la vez un ejercicio del catálogo; ningún alias apunta a algo inexistente; todo nombre del catálogo se resuelve a sí mismo; 0 claves ambiguas en el índice normalizado.

### Oficiales vs personalizados — CERRADO

| Oficial | Personalizado |
|---|---|
| Está en `EXERCISES` | **NO** entra a `EXERCISES` |
| Aparece en Biblioteca, Explorador y rutinas automáticas | **NO** participa de la generación automática |
| Usa la clasificación oficial y los sistemas derivados | Sirve para rutinas personalizadas y registros |

El comportamiento permitido hoy es **aceptar un nombre desconocido escrito a mano**: no bloquearlo y **no canonicalizarlo silenciosamente** hacia un oficial. El sistema completo de creación y configuración de personalizados (incluido elegir sus regiones para el Muscle Map) es una etapa posterior; lo único que hay que respetar ahora es no cerrarle la puerta.

### Autocompletado — CERRADO

`exerciseSuggestions(query)` es puro y devuelve la lista **completa** ya ordenada; `attachAutocomplete(input, listEl, onSelect)` hace la presentación.

- Mínimo **2 caracteres** (`AC_MIN_CHARS`), **4 resultados** iniciales (`AC_INITIAL`) y fila `"Ver X más..."` que **expande en el mismo lugar**. Esa fila **no lleva `data-val`**: no se puede elegir como ejercicio.
- Jerarquía (`AC_RANK`): **exacta → comienzo → todas las palabras → alias → parcial**. A igual nivel gana el **nombre más corto**; el alfabético decide el último empate.
- Tolerante a mayúsculas, tildes y espacios repetidos (`normalizeSearch`), con varias palabras en cualquier posición.
- **Los aliases aportan vocabulario, no entradas**: se muestra siempre el nombre oficial de destino, y la UI **no explica** por qué apareció un resultado.
- Sugiere **solo ejercicios oficiales activos**. El input sigue siendo **texto libre**: propone, nunca autoselecciona ni bloquea.

---

## 4. Taxonomía muscular

`MUSCLE_MAP` es la **raíz** de la taxonomía:

```js
"Press de banca con barra": { diagram:"front-upper", t:[["chest-mid",1],["shoulder-front",0.35]] }
```

De ahí se **derivan** (no se almacenan) grupo, subgrupo, subgrupo de 10, foco de pierna, principal/secundario y el rol en el mapa. **Las derivaciones dependen solo de la región de intensidad MÁXIMA.** Consecuencias permanentes:

- Agregar una región con intensidad **menor** al máximo **no puede** cambiar grupo ni subgrupo. Es imposible, no improbable.
- Agregar una **mayor o igual** al máximo **sí** los cambia, y arrastra pools, generador y rutinas guardadas **en silencio**. Es el riesgo que protege la baseline (§6).
- `exercisePrimarySubgroup` usa `>` **estricto**: ante un empate ganaría la **primera región declarada del array**. Hoy no hay empates, así que la dependencia del orden está latente.
- Un ejercicio **sin** `MUSCLE_MAP` no falla: **desaparece en silencio** de grupo, subgrupo, pools, Explorador y mapa (es el caso del cardio).
- Un ejercicio **sin** `EXERCISE_PATTERN` recibe el fallback `"nombre:X"` y predominancia `MEDIA`, así que nunca se considera variante de nada; el generador puede ofrecer dos variantes casi idénticas el mismo día.
- `diagram` es un **campo vestigial**: desde V32 ningún consumidor lo lee (la silueta la elige `viewsForRegions` a partir de las intensidades). Sigue en todas las entradas y la baseline lo vigila; no lo borres sin decisión.

**26 regiones anatómicas**, todas con subgrupo, todas en el SVG, todas clickeables; la correspondencia `MUSCLE_MAP` ↔ SVG es completa en los dos sentidos. **8 subgrupos** (pecho, espalda, hombros, biceps, triceps, antebrazo, core, piernas) → **6 grupos visuales** (Pecho, Espalda, Hombros, Brazos, Core, Piernas). `SHARED_REGIONS`, que se dibujan en ambas siluetas: `shoulder-lateral`, `traps`, `forearms`, `obliques`, `calves-gastro`.

Decisiones de V31 que **no son intuitivas y no hay que "corregir"**: `traps` vive en **hombros**, `lower-back` vive en **core** (y por eso `Hiperextensiones` cuenta como Core), y `Abductores en máquina` mapea a `glutes` porque no existe una región de glúteo medio y no se va a inventar.

**Las cuatro taxonomías conviven y NO son idénticas:** `REGION_SUBGROUP` (26 regiones → 8 subgrupos) · `SPECIAL_SUBGROUPS` (10, Día Especial, con 4 focos de pierna) · `FOCUSED_GROUPS` (11, Rutina enfocada; incluye `aductores` y usa `isquios` donde el de 10 usa `isquiosurales`) · `EXPLORER_SUBFILTERS.Piernas` (5, incluye Aductores).

**Conflicto abierto con Aductores** (D3): está en `FOCUSED_GROUPS` y en el Explorador, pero **no** en `LEG_FOCUS_TO_SUBGROUP10` ni en `SPECIAL_SUBGROUPS`. Por eso `exerciseSubgroup10("Aductores en máquina") === null`, es el único que `ambiguousLegExercises()` reporta y `canFocusStandAlone("aductores") === false` (el mínimo es 2 por foco). **Está declarado y vigilado por un test. No improvisar un arreglo.**

---

## 5. Generadores de rutina

Tres sistemas distintos, con pools y reglas propias: **Rutina automática semanal** (`SPLIT_DAYS` 1–6 días, cobertura semanal, reparto por sexo/edad) · **Día Especial** (un subgrupo de los 10) · **Rutina enfocada** (1–4 focos de los 11).

- **Tope diario duro** por cantidad de días: 1–2 → 8; 3–4 → 7; 5–6 → 6. La cobertura semanal está **subordinada** al tope, nunca al revés.
- `REQUIRED_WEEK_SUBGROUPS`: pecho, espalda, hombros, biceps, triceps, core. `REQUIRED_LEG_FOCI`: quads, hamstrings, glutes, calves.
- Enfocada: máximo por cantidad de focos 1→6, 2→8, 3→9, 4→10; tope duro 10; mínimo total 3; mínimo 2 por foco.
- Perfil 50+: `EXERCISES_RISKY_50PLUS` sale del pool candidato. **Favorece** máquina/polea, nunca prohíbe los libres al 100 %.
- El prime bump depende **solo de la edad**. El **peso corporal no influye** en la generación de rutinas y no debe volver a influir.
- El Día Especial **no suma a la meta semanal** y se guarda con `is_special`.
- Los tres generadores usan **únicamente el catálogo oficial activo**.

---

## 6. Mapa muscular (V43 / V43.1) — CERRADO

Pantalla propia (`state.tab = "mapa"`), se entra desde Perfil. **No modificar sin pedido explícito.**

- Motor **puro y testeable**: `muscleMapStats(registros, hoy, dias, rnd)`. Sin DOM, sin `state`, sin Supabase. La UI no calcula fechas ni interpreta `MUSCLE_MAP`.
- Fuente de datos: **`state.registros` exclusivamente**. No se usa `entrenos`.
- Períodos: **7 / 30 / 90 días móviles**. No meses ni semanas calendario.
- 26 regiones, tomadas de `REGION_VIEW` (sin una segunda lista).

**Puntuación — independiente del orden.** La intensidad de `MUSCLE_MAP` **solo decide el rol** (principal = región de intensidad máxima; el resto, secundaria). **No multiplica el puntaje.** Cada rol tiene su escalera y los dos totales se suman:

```
principal:  [1, 0.5, 0.25]      secundaria: [0.5, 0.25, 0.25]
puntos = escalera(principal, nP) + escalera(secundaria, nS)
```

`nP`/`nS` son **cuántos** ejercicios distintos de ese rol tocaron el sector ese día: función pura de dos números, **el orden de los registros no entra**. 0,25 es el piso por ejercicio. Dedupe por fecha + ejercicio canónico. Las series **no** afectan el color (sí la frecuencia, con las secundarias pesando la mitad). Referencia: 1P=1 · 1S=0,5 · 2P=1,5 · 4P=2 · 6S=1,75 · **1P+1S=1,5**.

**Escala de color — rampa afín, sin zona plana.**

```js
mapaIntensidad(v) = v>0 ? MAPA_TINTE_MIN + (1-MAPA_TINTE_MIN)*min(v,5)/5 : 0
// MAPA_TINTE_MIN = 0.12   MAPA_VISUAL_MAX = 5
```

Estrictamente creciente: `0 → 0` (gris), `0,25 → 0,164`, `5 → 1`, `>5 → 1` (el valor interno **no** se trunca, solo el color satura). **`mapaIntensidad` es la única fórmula de color** — la usan las siluetas, la barra de escala y los puntos de la lista; no duplicarla. `MAPA_TINTE_MIN` **no es un piso sobre el valor**: un piso (`max(0.12, v/5)`) achataba todo lo que estuviera por debajo de 0,6 puntos a un mismo color y rompía la escala conceptual. No volver a eso.

**Lo que el mapa NO hace:** no cuenta registros sin fecha válida, con fecha futura, que no canonicalicen, ni sin `MUSCLE_MAP`. Cardio no pinta nada. **No juzga**: sin semáforo rojo/amarillo/verde y sin frases evaluativas ("músculo descuidado", "equilibrado"). Muestra datos.

---

## 7. `baseline-clasificacion.js`

Foto determinista de cómo quedan clasificados los ejercicios con `MUSCLE_MAP`: una fila por ejercicio con nombre canónico, grupo, subgrupo, `diagram` y el array `t` completo en su orden original, en orden alfabético es-AR.

Vive en la raíz, la carga **solo** `tests-v31.html` con un `<script src>` y queda en `window.VODAFIT_BASELINE_CLASIFICACION`. **La app no la carga ni debe cargarla** — hay un test que lo verifica: si `index.html` dependiera de ella, dejaría de ser una verificación independiente. Existe porque un test no puede comparar "antes y después": solo hay una versión del código a la vez, así que la única forma de detectar que alguien movió la región principal es tener la foto del estado aprobado commiteada **antes** de tocar `MUSCLE_MAP`.

**Regla de actualización:** cuando el cambio sea **deliberado**, se actualiza la fila de ese ejercicio **en el mismo commit que el cambio**. **Nunca se actualiza "para que el test pase":** si un test de baseline falla y nadie quiso ese cambio, el bug está en `MUSCLE_MAP`. Regenerarla sin cambios reales produce un archivo idéntico, así que **cualquier diff es un cambio de verdad**.

**Casos especiales declarados (y NO corregidos):** **0 empates** en la intensidad máxima (latente, no garantizado por el código); **3 ejercicios con máximo 0.9**, no 1 — `Fondos de tríceps en banco`, `Patada de tríceps`, `Press cerrado` —, que funcionan porque la regla es "máximo relativo" y **cualquier regla futura que compare contra `=== 1` los rompe**; y **`Aductores en máquina`** sin subgrupo de 10 (§4).

---

## 8. Perfil y peso — CERRADO

- Perfil es un **dashboard de lectura**, no un formulario de carga. "Tu peso" es solo lectura: sin alta, sin editar, sin borrar.
- El peso corporal vive en `peso_corporal`, **no** en `registros`.
- `profiles.peso_estimado` **dejó de ser fuente de verdad** y salió de la UI. **No reincorporarlo.**
- Perfil y Rutina tienen **estado de semana separado**: navegar semanas en uno no mueve el otro.

---

## 9. Decisiones abiertas

No resolverlas por cuenta propia. Si una aparece mientras trabajás en otra cosa, **documentala y seguí**.

| Id | Tema |
|---|---|
| **D2** | Músculos **asistentes**. Patrón actual: los presses no acreditan tríceps, los remos y dominadas no acreditan bíceps, `forearms` casi no se usa, los compuestos de pie no acreditan core. Riesgo: casi todas las fichas muestran **una** silueta con peso 0 en la opuesta, así que un asistente de la vista contraria con intensidad ≥ `VIEW_RELEVANCE_MIN` (0,25) las pasa a **dos** siluetas. |
| **D3** | Jerarquía del tren inferior y Aductores. Si se implementa, debe ser **solo navegación**: sin pesos, sin filtrarse a `SUBGROUP_BASE_WEIGHT` / `LEG_ROLE_WEIGHTS` / `REQUIRED_LEG_FOCI`. "Complementario" no significa menos importante. El pool tiene que existir **antes** que la categoría. |
| **D4** | Abdomen y cardio. Los de cardio son huérfanos en toda la app (sin grupo, subgrupo, lámina ni Explorador), no solo en el mapa; "Cardio" es además un valor de **equipamiento**. |
| **D5** | Ampliar el catálogo, sin llenarlo de variantes casi idénticas. |
| **D6** | Huecos de contenido: ejercicios sin tips, sin link, `Hip thrust con barra` sin lámina, y links huérfanos en `EXERCISE_HOWTO_LINKS` que apuntan a ejercicios inexistentes. |

Rumbo acordado para `MUSCLE_MAP`: **ampliar contenido manteniendo la estructura actual**. No hacen falta regiones nuevas, y el rendimiento no es un problema (`muscleMapStats` ~1 ms y `generateAutoRoutine` ~4 ms con 1000 registros: triplicar el catálogo sigue muy por debajo de un frame).

---

## 10. Testing

`tests-v31.html` es el único harness: autocontenido, sin npm y sin build. Carga `index.html` en un iframe y valida contra `window.__appTest`.

- **Correr con un servidor estático** (`http://`). Con `file://` el iframe queda bloqueado.
- **El harness corre la suite DOS VECES**: el total reportado es el doble del real. Dividir por 2 antes de informar.
- Resultados en `window.__v31Results = { pass, fail, total, failures }`.

1. **Correr toda la suite** después de cualquier cambio, no solo los tests nuevos.
2. **Revisar la consola en una pestaña limpia.** Los mensajes persisten entre navegaciones, así que "sin errores" medido en una pestaña reusada no vale.
3. **No modificar un test para que pase.** Si refleja una decisión que cambió, se reescribe afirmando la **decisión nueva** —no se afloja la aserción— y se explica cuál era la contradicción.
4. Los mensajes de fallo tienen que decir **qué ejercicio, qué se esperaba y qué se obtuvo**. Los tests que recorren el catálogo **acumulan todas las diferencias** antes de fallar, en vez de cortarse en la primera.
5. **Los tests unitarios no alcanzan.** Verificar también en runtime: generar rutinas, medir el DOM, mirar la consola.
6. Preferir **invariantes** sobre tablas literales donde se pueda: una regla alcanza también a lo que se agregue después.
7. Al cambiar un conteo "candado" (ejercicios, aliases, tamaño de pools), **escribir en el código el motivo del cambio**.

**Cuidado con los tests que dependen de la fecha.** `computeRacha` agrupa por semana **ISO (lunes a domingo)**, así que `diasAtras(0)` y `diasAtras(1)` **no** siempre caen en la misma semana: los lunes, `diasAtras(1)` es de la semana anterior. Para "varios entrenos de esta semana", usar `diasAtras(0)` repetido — `computeRacha` cuenta **entradas**, no días distintos.

---

## 11. Git: commits, push y deploy

- **No hacer commit, push ni deploy salvo pedido explícito**, incluso con el trabajo terminado y los tests en verde.
- Un pedido de **commit** no autoriza push. Un pedido de **push** no autoriza deploy.
- Si piden pushear un commit concreto, **verificar antes si tiene ancestros sin pushear**: git no puede subir un commit sin sus padres. Avisarlo antes, no después.
- Mensajes en español, con el formato `Vxx: descripción corta`.

---

## 12. Deuda conocida (no son bugs a arreglar de taquito)

`VodaFit` vs `Voda Fit` conviven en la UI; `manifest.theme_color` es `#171412` mientras `background_color` es `#111111`; `VODAFIT_CONTEXT.md` y `VODAFIT_DECISIONS.md` quedaron congelados en V37/V34 y **no reflejan el estado actual** — ante una contradicción manda el código, y después este archivo.
