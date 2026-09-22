# VodaFit - Project Context

## Product

VodaFit is a fitness PWA for personal/family use, with possible future
public/commercial release. Current priority: product quality and
correctness.

## Architecture

-   Static web app.
-   `index.html` contains the main HTML/CSS/JS.
-   `manifest.json`, `sw.js`, icons.
-   Exercise media in flat `ejercicios/`.
-   Supabase Auth/Postgres with RLS.
-   GitHub source repository.
-   Vercel deployment.

## Major features

Authentication/profile, Mi rutina, Rutina automática, manual editor, Día
Especial, exercise library/detail, media, checklist, Timer, per-set
weight/reps, history, weekly-max graph, CSV, calendar/streak/weekly
goal, muscle explorer, PDF export, light/dark theme, PWA.

## Session system

-   One active workout at a time.
-   Save/continue active session.
-   Per-set logging.
-   Exercises remain independent when reordered or used as supersets.
-   `set_number` exists for per-set records.
-   Finalization creates the workout record and updates relevant
    progress.
-   "Guardar entrenamiento" is not finalization.

## Día Especial

-   Always available.
-   No date condition.
-   No weekly-goal condition.
-   Can occur before the weekly routine, between workouts, after goal
    completion, or multiple times in one day.
-   Appears in history/calendar.
-   Does not increment weekly goal.
-   Only one active workout at a time.
-   Identified by `entrenos.is_special`.

## Automatic routine: legs

General group "Piernas", internally: - Cuádriceps - Glúteos -
Isquiosurales - Gemelos - Aductores

Priority: quads high, glutes high, hamstrings medium, calves secondary,
adductors accessory.

Multiple lower-body opportunities alternate emphasis: Cuádriceps -\>
Glúteos -\> Cuádriceps -\> Glúteos.

First emphasis: Masculino = cuádriceps; Femenino = glúteos.

Established classifications (updated in V31): Abductores en máquina =
Glúteos (unchanged). **V31 explicitly reclassified the following**, and
these supersede the previous rule that deadlifts, sumo deadlifts and
hyperextensions were back exercises:

-   Sentadilla Sumo = principal Glúteos (Aductores and Cuádriceps are
    now secondary; it is no longer principal Aductores).
-   Peso muerto con barra / con mancuernas / sumo = principal Glúteos,
    with Isquios secondary (no longer principal zona lumbar/Espalda).
-   Peso muerto rumano (barra y mancuernas) = principal Isquios.
-   Hiperextensiones = principal Core / zona lumbar, with Glúteos and
    Isquios secondary (no longer principal Espalda). The `lower-back`
    region now maps to the `core` subgroup.
-   Face Pull and Remo al mentón = principal Hombros.
-   Encogimientos = principal Trapecios; the `traps` region now maps to
    the `hombros` subgroup, so Trapecios stays inside the Hombros visual
    group. No seventh visual group was created.

## Classification rule (V31)

Every exercise has exactly ONE principal muscle and zero or more
secondaries. Both are derived from the intensity weights in
`MUSCLE_MAP` (`exercisePrimarySubgroup` /
`exercisePrincipalSecondaryGroups`) — there is no parallel
classification structure and no second source of truth.

Additional V31 structures, none of which duplicate muscle data:
`EXERCISE_ALIASES` (old name → canonical name, so renames never break
history), `EXERCISES_RETIRED` (out of the active pools but kept in
`MUSCLE_MAP` for history/CSV/PDF), `EXERCISE_PATTERN` +
`PATTERN_PREDOMINANCE` + `PATTERN_PREDOMINANCE_WEIGHT` (single
four-level scale: ALTA / MEDIA_ALTA / MEDIA / BAJA), and
`ageEquipmentWeight` (age/equipment preference).

Pattern diversity beats nominal diversity: two variants of the same
pattern are not selected while a different pattern is still available.

## Age and equipment (V31)

A single reusable function, `ageEquipmentWeight(nombre, edad)`, applied
as the final weighting layer in every selector:

-   \<40: no change.
-   40-49: moderate preference for machine/Smith.
-   50+: stronger preference for machine/Smith.

This is weighting only, never a prohibition — free-weight exercises stay
selectable at any age. `EXERCISES_RISKY_50PLUS` remains an independent
hard-exclusion rule and is unchanged.

## Automatic routine: series

-   Age \<=29: base 4.
-   Age 30+: base 3.
-   No age: base 3.
-   Isolation: 3.
-   No automatic 2-series exercises under the current rule.
-   Keep `restRangeForAge` and `EXERCISES_RISKY_50PLUS` unchanged unless
    requested.

## Automatic routine: enfocada (V31)

"Rutina automática enfocada" is a fourth modality that does NOT replace
Mi rutina, Rutina automática or Día Especial. The user picks 1 to 4
focus groups per day (5 or more is rejected) and VodaFit builds that
day. Days are generated and regenerated individually — regenerating one
day never touches the others.

Selectable focuses (11): Pecho, Espalda, Hombros, Bíceps, Tríceps,
Cuádriceps, Glúteos, Isquios, Aductores, Gemelos, Core. Brazos as a
generic group and Antebrazo as a standalone focus are deliberately NOT
offered.

Exercise count: 1 focus → 3-6; 2 → max 8; 3 → max 9; 4 → max 10; never
more than 10, never fewer than 3, and at least 2 per focus when there
are enough candidates.

A focus can only be used as the sole focus of a day when its own
principal pool holds at least 3 exercises; otherwise the selection is
rejected and it has to be combined. The check reads the same pool the
generator will use (including the 50+ hard exclusion), so the UI never
offers a combination the generator cannot fulfil. In the modal such a
focus is marked with a "+" and explains itself; the generate button
stays disabled until another focus is added. Today this applies only to
Aductores. Bíceps + Tríceps as the only two focuses builds
3 tríceps / 2 bíceps / 1 antebrazo (the antebrazo does not count as a
third chosen focus).

It is stored in the third `rutinaSlots` slot (`enfocada`) inside the
existing `rutinas.data` blob — no new table. A finished enfocada
workout is a normal workout: it appears in history and the calendar and
counts toward the weekly goal and the streak. Día Especial keeps its
current behaviour and is unaffected.

## Calendar

Visual distinction: - Mi rutina = strong orange. - Rutina automática =
light orange. - Rutina enfocada = teal (V31). - Día Especial = distinct
purple. - Marcado manual / Origen desconocido = neutral. - Small
legend. Colors are informational only and must not alter goal, streak or
progress logic.

`entrenos.routine_origin` accepts `personalizada`, `automatica`,
`enfocada`, `especial` or NULL (see `supabase-migration-v31.sql`). The
enfocada origin is never hidden behind `automatica`.

## Exercise Explorer

Counts after the V31 reclassification (active exercises only; retired
ones keep their detail page but are no longer offered):

Pecho (13) - Espalda (16) - Piernas (28) - Hombros (17) - Brazos (18) -
Core (9).

Brazos contains three subgroups: bíceps, tríceps and antebrazo. The
antebrazo subgroup has its own exercises (Curl de muñeca, Curl de
muñeca inverso) and lives inside the Brazos visual group — there is no
seventh visual group.

Piernas exposes: - Todos (28) - Cuádriceps (7) - Glúteos (12) -
Isquiosurales (4) - Gemelos (4) - Aductores (1)

The Glúteos count grew and Espalda shrank because the deadlifts moved to
Piernas and Hiperextensiones moved to Core. Aductores dropped to 1
because Sentadilla Sumo is now principal Glúteos. Abductores is not a
separate visible group: Abductores en máquina belongs to Glúteos.

## Media/legal

Do not invent or rehost third-party media. Verify external links. Do not
delete existing media without approval.

## Validation

Recent reported tests: - V28: 58/58. - V29: 71/71. - Día Especial always
available: 12/12. - Día Especial/explorer test: 26/26 after simulating
missing migration. - Latest legs logic: 29/30, with the marked point
related to finalization rather than leg-generation logic.

## Supabase issue

V29 requires:
`public.entrenos.is_special boolean not null default false`

The app now exposes the real Supabase error if registration fails.
