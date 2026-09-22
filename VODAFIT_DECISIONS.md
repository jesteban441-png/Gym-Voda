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
