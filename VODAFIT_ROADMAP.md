# VodaFit - Roadmap

## Current priority: finish V31

1.  Apply `supabase-migration-v31.sql` (adds `enfocada` to the
    `routine_origin` CHECK). Until it runs, finalizing an enfocada
    workout will be rejected by the database.
2.  Verify enfocada finalization against real Supabase, and that it
    counts toward the weekly goal and the streak.
3.  Verify the calendar's four workout-origin states plus manual and
    unknown.
4.  Verify Explore \> Piernas subgroup filters with the new counts
    (Todos 28 / Cuádriceps 7 / Glúteos 12 / Isquiosurales 4 / Gemelos 4
    / Aductores 1).
5.  Run `tests-v31.html` (served over http://, not file://) and the
    regression checks it contains.
6.  Confirm the repaired `sw.js` registers correctly once deployed —
    the V30 commit had left a git patch file in its place, so the PWA
    had no working Service Worker.
7.  Decide on media for the 19 new exercises that currently have none
    (they are functional without it), including Curl de muñeca and
    Curl de muñeca inverso.
8.  Deploy after confirmation.

## Pending decisions

-   Media (photo/video) for the V31 exercises listed as missing. No
    media was invented and no mapping was guessed.
-   Whether "Zancadas" (bodyweight) should come back as an active
    exercise; V31 retired it because the definitive Piernas list only
    includes "Estocadas con mancuerna".

## Next

-   Audit external exercise links.
-   Continue exercise-library cleanup.
-   Plan replacement/removal of third-party media only after the link
    strategy is confirmed.
-   Continue mobile UX cleanup without a full redesign.

## Future, deliberately postponed

-   Premium.
-   Coach.
-   Gym administration.
-   Google OAuth.
-   AI assistant.
-   AI routine/photo interpretation.
-   AI-generated exercise media.
-   Store launch preparation.

Do not implement postponed items unless explicitly requested.
