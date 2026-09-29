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
history — extended in V34, see "Exercise identity"),
`EXERCISES_RETIRED` (out of the active pools but kept in
`MUSCLE_MAP` for history/CSV/PDF), `EXERCISE_PATTERN` +
`PATTERN_PREDOMINANCE` + `PATTERN_PREDOMINANCE_WEIGHT` (single
four-level scale: ALTA / MEDIA_ALTA / MEDIA / BAJA), and
`ageEquipmentWeight` (age/equipment preference).

Pattern diversity beats nominal diversity: two variants of the same
pattern are not selected while a different pattern is still available.

## Exercise identity (V34)

An exercise is identified by its CANONICAL NAME. There is no parallel
table of exercise IDs, and exercise identity does not depend on any SQL
migration — V34 added none.

Resolution has exactly two layers, in this order, both inside
`canonicalExerciseName`:

1.  `EXERCISE_ALIASES` — the EXPLICIT layer, and the only source of
    confirmed equivalences. Every entry was decided by hand. It always
    wins.
2.  `EXERCISE_NORMALIZED_INDEX` — the normalizing layer. It collapses
    differences of SPELLING only: case, accents, punctuation, spacing
    and a closed set of 15 prepositions/articles
    (`EXERCISE_NAME_STOPWORDS`). The index is built from `EXERCISES`
    plus the targets of `EXERCISE_ALIASES` — no new catalogue.

The normalizing layer never invents semantic equivalences. Words that
distinguish one variant from another (`plano`, `inclinado`,
`unilateral`, `inverso`, `alternado`, and every equipment word) are
deliberately NOT stopwords, so `Press de banca con barra` and
`Press de banca inclinado con barra` stay different exercises. It
resolves only when the normalized key maps to exactly ONE canonical
name; if two canonical names ever shared a key, the key is marked
ambiguous and stops resolving rather than guessing. There are currently
zero ambiguous keys, and a test fails if one appears.

`Gemelos` → `Gemelos parado con mancuerna` is the only alias added in
V34. It was confirmed by hand against the identity diagnostics (5
historical records, 2 appearances in routines); it is a genuinely
different name, not a spelling variant, so the normalizing layer
deliberately left it unresolved. Alias count: 38.

Canonicalization is applied on BOTH sides:

-   On write — `registroRowFor` (the single write point for `registros`)
    canonicalizes the name, so new rows always carry the canonical
    identity. `updateRegistro` never touches `exercise`.
-   On read — `rowToRegistro` canonicalizes every row coming out of
    Supabase.
-   On routine load — `canonicalizeRutinaSlots` /
    `canonicalizeDayNames` rewrite only the `nombre` field of the three
    slots (plus the embedded Día Especial day) in `loadProfileData`,
    before any screen uses the data. Exercise `id`s are untouched, so an
    in-progress session (which indexes `sets`/`setLogs` by `id`) is
    restored unaffected. It is idempotent and forces no write: the
    `rutinas.data` blob is rewritten canonicalized on the next ordinary
    `persistRutina()`.

History is grouped and queried by canonical name, so records saved under
an old name and records saved under the current one share one history,
one evolution graph and one exercise detail page. The name shown to the
user is always the current canonical one — in the routine, the history,
the exercise detail, the CSV and the PDF.

Historical Supabase rows were NOT migrated or physically modified. No
row was deleted or rewritten; old names are resolved at read time. A
name that resolves to nothing is left exactly as it is.

`exerciseIdentityDiagnostics` (Perfil → Diagnóstico → Identidad de
ejercicios) is a read-only report of the raw names present in the user's
own records and routines, split into unresolved / resolved by
normalization / ambiguous. It never writes, never deletes and never adds
aliases — new equivalences are only ever added by hand.

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

## Automatic routine: exercises per session (V36)

Previously undocumented; written down in V34 and rewritten in V36 when
the daily limit became a HARD cap.

The daily maximum is FIXED by days/week (`sessionCountRange`) and is a
hard cap — no rule may exceed it:

-   1-2 days/week: maximum **8** exercises per day.
-   3-4 days/week: maximum **7**.
-   5-6 days/week: maximum **6**.

Both ends of every range are equal, so `biasedTarget` always returns that
exact number and its sex-based bias is currently inert.

### The prime bump does not raise the cap

`profileHasPrimeBump()` (age 19-35 only — see "Body weight is not a
generator variable (V34)") used to add `randInt(1,2)` exercises per day
capped at a global 8. That global 8 ignored the day's own limit, so with
5-6 days/week (base 6) the bump could push a day to 8, above its cap.

Since V36 the bump is capped at the DAY's limit. Because `lo === hi` in
the table, that leaves it with **no effect on the exercise count**: a
profile aged 19-35 and one aged 45 produce the same number of exercises
per day. The bump's condition was NOT changed and the function is still
called; it simply cannot change the count any more.

Consequence worth knowing: `profileHasPrimeBump` currently has no other
consumer, so it is functionally inert. Giving it a new role as a
selection/priority signal (for example biasing towards compound lifts)
would be a separate decision — it has not been done.

### Weekly coverage is subordinate to the daily cap

Priority order, highest first:

1.  respect the daily cap;
2.  keep the existing structure and distribution;
3.  maximise weekly coverage;
4.  apply focus and the other existing rules without breaking the cap.

The two safety nets in `generateAutoRoutine` (`REQUIRED_LEG_FOCI` and
`REQUIRED_WEEK_SUBGROUPS`) used to `push` onto a day without checking how
full it was, which is why a day of 8 could end up with 9 to 11
exercises. They now go through `coverageAdd`, which:

-   pushes when the day still has room;
-   otherwise substitutes — it drops an exercise whose muscle bucket
    already has 2 or more entries in that day (so nothing loses coverage)
    and that `isSafeToDropForFocus` allows to drop, preferring an
    isolation exercise over a compound;
-   otherwise does nothing, and that group stays uncovered for the week.

There is deliberately NO final `slice` of the day: trimming by position
could throw away the very exercise that provided the coverage. The
decision is taken at insert time.

### Coverage actually achieved

Measured over the current test suite:

-   **1 day/week: Core and Gemelos (calves) can stay uncovered.** The
    template is a single full-body day with 7 groups and a `piernas: 2`
    minimum; the 6 upper/core subgroups plus the 4 leg foci need at least
    10 distinct exercises (every exercise has exactly ONE principal
    muscle) and the cap is 8. The two goals are arithmetically
    incompatible, so the cap wins.
-   **2 days/week: Core can stay uncovered.** The 4 leg foci are covered.
    Capacity (16) would allow Core, but the full-body split gives legs 3
    of the 8 slots and the substitution finds no valid donor: the three
    leg exercises each have a different focus, and the V29.1 rules
    protect the last quad and the last glute of the day.
-   **3-6 days/week: full coverage.** All 6 subgroups and all 4 leg foci,
    in every generated week of the test suite.

Weekly totals with the hard cap: 1 day 8, 2 days 16, 3 days 21, 4 days
28, 5 days 30, 6 days 36 — the same with and without the bump.

## Body weight is not a generator variable (V34)

Body weight is a TRACKING METRIC. It must never automatically change the
number of exercises, the series, the rest or any other output of the
automatic generators.

Until V34 the prime bump also required `peso` between 73 and 93 kg. That
was decoupled because body weight is becoming a metric with its own
history: crossing 73 or 93 kg would have silently changed routine volume
(up to 7 exercises per week at 6 days/week, and abruptly, since the
threshold was hard). The bump now reads only `edad`.

The change is strictly additive: every profile that had the bump still
has it, and profiles aged 19-35 whose weight fell outside 73-93 kg (or
who had no weight loaded) now get it too. No profile lost the bump.

`profiles.peso_estimado` still exists and is still read into
`state.profile.peso`, shown in the signup form and in Perfil. After V34
NO generator reads it: `profileHasPrimeBump` was its only functional
consumer. It has not been removed or renamed.

## Pending findings

-   RESOLVED in V36 — the daily cap was not enforced: the weekly-coverage
    safety nets pushed onto a day without checking it, so 1 day/week
    always produced 11 exercises and 2 days/week produced 9-10,
    identically with and without the prime bump. The cap is now hard and
    coverage is subordinate to it. See "Automatic routine: exercises per
    session (V36)".
-   The test harness in `tests-v31.html` runs the whole suite TWICE, so
    the summary reports double the real test count. Cosmetic, but it makes
    reported numbers confusing. Not fixed.

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

Pecho (13) - Espalda (15) - Piernas (28) - Hombros (17) - Brazos (18) -
Core (9).

Espalda dropped from 16 to 15 in V35.3: `Jalón agarre ancho` was unified
with `Jalón al pecho` (same identity — same equipment, same pattern, same
MuscleWiki link) and retired, so there is only ONE active identity for
that movement. It keeps its `MUSCLE_MAP` entry and detail page, and its
history is grouped under the canonical name. `Jalón tras nuca` is
unrelated and stays an independent retired identity.

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
- V34: 172/172 in `tests-v31.html` (exercise identity + prime-bump
decoupling).
- V35 (identity consolidation): 209/209.
- V36 (hard daily cap): 225/225. The harness reports double every number
because it runs the suite twice; the real single-run count is 225.

## Supabase issue

V29 requires:
`public.entrenos.is_special boolean not null default false`

The app now exposes the real Supabase error if registration fails.
