# VodaFit - Product Decisions

## Sessions

-   One active workout at a time.
-   Do not silently replace/discard an active session.
-   "Guardar entrenamiento" saves current state.
-   Finalization is separate.
-   Per-set logging is required.

## Día Especial

-   Always available unless another workout is active.
-   Independent of date and weekly goal.
-   Can occur before, between or after weekly workouts.
-   Can occur multiple times in one day.
-   Appears in history/calendar.
-   Does not increase weekly goal.
-   Uses the existing session architecture.
-   Stored with `is_special = true`.
-   Do not auto-finalize an existing active workout.

## Automatic routine

-   Piernas remains a general user-facing group.
-   Internally subdivided into five subgroups.
-   Quads/glutes remain predominant.
-   Multiple lower-body days alternate quad/glute emphasis.
-   Explicit focus has priority while preserving safety/structure.
-   No automatic 2-series exercises under the current rule.

## Body weight and the automatic generator (V34)

-   Body weight is a TRACKING METRIC, not a generator variable. It must
    never automatically change the number of exercises, the series, the
    rest or any other output of the automatic generators.
-   The body-weight history is independent of the generator. Recording a
    new body weight never regenerates or re-sizes a routine.
-   The "prime" bump (`profileHasPrimeBump`) is based on AGE ONLY:
    `edad >= 19 && edad <= 35`. No age loaded → no bump.
-   Everything else about the bump is unchanged: it still adds
    `randInt(1,2)` to each day's target with the same cap of 8. The base
    count per session, the weekly-coverage rule, the series and the rest
    ranges were NOT touched.
-   Until V34 the bump also required `peso` 73-93 kg. Decoupled by
    explicit decision: with body weight becoming a tracked metric,
    crossing 73 or 93 kg would have changed routine volume on its own
    (up to 7 exercises per week at 6 days/week) across a hard threshold.
-   The decoupling is strictly additive. No profile lost the bump;
    profiles aged 19-35 with a weight outside 73-93 kg, or with no weight
    loaded, now receive it. This is intentional.
-   `profiles.peso_estimado` is NOT removed or renamed. It stays in
    `profiles`, is still read into `state.profile.peso` and still shown
    in signup and Perfil. After V34 no generator reads it —
    `profileHasPrimeBump` was its only functional consumer.
-   Pending, deliberately NOT fixed: the "hard cap of 8 exercises per
    day" is not enforced, because the weekly-coverage safety net ignores
    it (1 day/week yields 11 exercises, 2 days/week yields 9-10). It is
    independent of the bump and needs its own decision about whether the
    cap or the coverage rule wins.

## Exercise Explorer

-   Legs can be explored through the five subgroups.
-   Explorer filtering must not change exercise classification.

## Library and classification (V31)

-   Every exercise has exactly ONE principal muscle plus zero or more
    secondaries, derived from `MUSCLE_MAP` weights. No parallel
    classification structure.
-   Renames never break history: `EXERCISE_ALIASES` maps every old name
    to its canonical name, and reads go through
    `canonicalExerciseName`. No historical data is deleted or rewritten.
    V34 extends this — see "Exercise identity (V34)".
-   Retired exercises leave the active pools but keep their data and
    detail page (`EXERCISES_RETIRED`).
-   Pattern diversity beats nominal diversity, and it is a hard rule:
    two variants of the same pattern are not selected while another
    pattern is still available.
-   Predominance uses ONE four-level scale (ALTA / MEDIA_ALTA / MEDIA /
    BAJA) via `PATTERN_PREDOMINANCE_WEIGHT`.
-   Age/equipment preference (`ageEquipmentWeight`) is weighting only,
    never a prohibition. `EXERCISES_RISKY_50PLUS` stays independent.
-   V31 reclassifications (explicit, they supersede earlier decisions):
    deadlifts → Glúteos/Isquios, Sentadilla Sumo → Glúteos,
    Hiperextensiones → Core/zona lumbar, Face Pull and Remo al mentón →
    Hombros, Encogimientos → Trapecios inside the Hombros group.

## Exercise identity (V34)

-   An exercise is identified by its CANONICAL NAME. There is NO parallel
    table of exercise IDs, and exercise identity does not depend on any
    SQL migration. V34 added no migration and no schema change.
-   `EXERCISE_ALIASES` is the explicit source of CONFIRMED equivalences.
    Every entry is decided by hand. It is the only place a semantic
    equivalence may be declared.
-   `canonicalExerciseName` resolves explicit aliases FIRST, then the
    normalization layer. Nothing else resolves identity: there is no
    second resolver and no second source of truth.
-   Normalization collapses SPELLING only — case, accents, punctuation,
    spacing and a closed set of prepositions/articles. It never invents
    semantic equivalences: words that distinguish a variant (`plano`,
    `inclinado`, `unilateral`, `inverso`, `alternado`, equipment words)
    are never stopwords.
-   Normalization resolves only when the result is UNIQUE. Ambiguity is
    never guessed: a key shared by two canonical names stops resolving
    and is reported as ambiguous.
-   `Gemelos` → `Gemelos parado con mancuerna` is the ONLY alias added in
    V34, confirmed by hand against the diagnostics. It is not a spelling
    variant, so normalization deliberately left it unresolved. It does
    not absorb `Gemelos en máquina`, `Gemelos en prensa` or
    `Gemelos sentado en máquina`, which are different exercises.
-   Canonicalization applies on write (`registroRowFor`), on read
    (`rowToRegistro`) and on routine load (`canonicalizeRutinaSlots`).
    Routine canonicalization rewrites only `nombre`; exercise `id`s are
    preserved so an in-progress session survives.
-   History is grouped and queried by canonical name: old and new names
    of the same exercise share one history, one graph and one detail
    page. The displayed name is always the current canonical one,
    including CSV and PDF.
-   Historical Supabase rows are NOT migrated or physically modified.
    Nothing is deleted or rewritten; old names resolve at read time. A
    name that resolves to nothing is preserved verbatim.
-   The identity diagnostics screen is read-only. It never adds aliases
    automatically — equivalences are only ever added by hand after being
    confirmed.

## Rutina automática enfocada (V31)

-   A fourth modality; it does not replace Mi rutina, Rutina automática
    or Día Especial.
-   The user chooses what to train each day; VodaFit builds the day.
-   1 to 4 focuses per day. 5 or more is rejected.
-   Generated day by day, regenerated day by day; other days are kept.
-   Limits: 1 focus → 3-6, 2 → 8, 3 → 9, 4 → 10. Never >10, never <3.
    At least 2 per focus when candidates allow.
-   A focus may be chosen as the ONLY focus of a day only if its own
    principal pool has at least 3 exercises. If it has fewer, the
    selection is rejected and the focus must be combined with another
    one. The day is never padded from a different group and secondaries
    are never promoted to protagonists.
-   The rule is derived from the pool size, not from a hardcoded list:
    if a focus gains exercises later it becomes standalone-capable on
    its own. Today the only affected focus is Aductores (1 principal
    exercise: Aductores en máquina). Aductores combined with any other
    focus works normally.
-   Bíceps + Tríceps only → 3 tríceps / 2 bíceps / 1 antebrazo.

## Antebrazo (V31)

-   Antebrazo is its own subgroup inside the Brazos visual group
    (`forearms` region → `antebrazo` subgroup → `Brazos`). No seventh
    visual group was created.
-   It has its OWN exercises: Curl de muñeca and Curl de muñeca
    inverso. Curl martillo is a bíceps exercise and is never used as a
    forearm substitute.
-   Antebrazo is not a user-selectable focus; it only appears as the
    "+1" of a Bíceps + Tríceps day.
-   It is not part of `SPLIT_DAYS` or `REQUIRED_WEEK_SUBGROUPS`, so the
    weekly automatic routine and Día Especial are unaffected.
-   Groups outside the chosen focus never become protagonists: pools are
    keyed by the exercise's principal. A secondary may appear naturally.
-   Stored in the `enfocada` slot of the existing `rutinas.data` blob.
-   Counts as a normal workout for history, calendar, weekly goal and
    streak. Día Especial is unaffected by this rule.

## Calendar

1.  Mi rutina = strong orange.
2.  Rutina automática = light orange.
3.  Rutina enfocada = teal (V31).
4.  Día Especial = distinct purple.
5.  Include a small legend. Colors are informational and must not alter
    goal, streak or progress.
6.  `routine_origin` distinguishes personalizada / automatica /
    enfocada / especial. The enfocada origin is never stored as
    `automatica`.

## Database

-   Schema changes require explicit SQL migrations.
-   Never assume a test schema equals the real Supabase schema.
-   Never put service-role credentials in frontend code.
