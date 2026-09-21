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

## Calendar

1.  Mi rutina = strong orange.
2.  Rutina automática = light orange.
3.  Día Especial = distinct third color.
4.  Include a small legend. Colors are informational and must not alter
    goal, streak or progress.

## Database

-   Schema changes require explicit SQL migrations.
-   Never assume a test schema equals the real Supabase schema.
-   Never put service-role credentials in frontend code.
