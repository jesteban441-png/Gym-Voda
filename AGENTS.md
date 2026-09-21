# VodaFit - Agent Instructions

## Purpose

VodaFit is a fitness PWA. ChatGPT is used for analysis/specification;
Claude and Codex are used for implementation, review and testing.

## Architecture

-   Static web app.
-   Main application is currently concentrated in `index.html`.
-   `manifest.json` and `sw.js` support the PWA.
-   Exercise media is under `ejercicios/`.
-   Supabase Auth/Postgres with RLS.
-   GitHub is the source repository.
-   Vercel is deployment.
-   Do not introduce a framework, build system, backend, serverless
    architecture, or new product architecture without explicit approval.

## Rules

1.  Inspect before modifying.
2.  Reuse existing functions/data structures before creating parallel
    systems.
3.  Do not change established behavior merely to satisfy an old test.
4.  Flag impacts to existing product decisions before implementation.
5.  Never invent exercises, media mappings, URLs, database columns, or
    requirements.
6.  Do not delete exercise media without explicit approval.
7.  Do not create a second session system.
8.  Never expose Supabase service-role secrets in client code.
9.  Any schema change needs an explicit migration.
10. Preserve mobile responsiveness and the existing VodaFit visual
    identity.
11. Keep Timer behavior stable unless explicitly requested.
12. Run relevant tests after changes and report failures honestly.

## Sessions

-   One active workout at a time.
-   `state.rutina` and `persistRutina()` are the established routine
    persistence path.
-   Per-set logging is established.
-   "Guardar entrenamiento" saves/continues the active session.
-   Finalization is separate.
-   Never silently discard an active workout.

## Important distinctions

-   Mi rutina, Rutina automática and Día Especial are different
    concepts.
-   Día Especial is always available when there is no other active
    workout.
-   Día Especial does not increment the weekly goal.
-   Día Especial is stored with `is_special`.

## Before finishing

Report what changed, what did not change, migration requirements, tests
and remaining decisions.
