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

Established classifications: Sentadilla sumo = Aductores/accessory;
Abductores en máquina = Glúteos. Deadlift, sumo deadlift and
hyperextensions remain classified as back unless explicitly changed.

## Automatic routine: series

-   Age \<=29: base 4.
-   Age 30+: base 3.
-   No age: base 3.
-   Isolation: 3.
-   No automatic 2-series exercises under the current rule.
-   Keep `restRangeForAge` and `EXERCISES_RISKY_50PLUS` unchanged unless
    requested.

## Calendar

Planned visual distinction: - Mi rutina = strong orange. - Rutina
automática = light orange. - Día Especial = distinct third color. -
Small legend. Colors are informational only and must not alter goal,
streak or progress logic.

## Exercise Explorer

Piernas exposes: - Todos (31) - Cuádriceps (9) - Glúteos (11) -
Isquiosurales (5) - Gemelos (4) - Aductores (2)

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
