-- V31: agrega el origen "enfocada" (Rutina automática enfocada) a los
-- valores permitidos de entrenos.routine_origin.
--
-- Contexto: V30 (supabase-migration-v30.sql) creó la columna routine_origin
-- con un CHECK que solo acepta 'personalizada', 'automatica', 'especial' o
-- NULL. La rutina enfocada es una modalidad propia y NO se guarda disfrazada
-- de 'automatica', así que el calendario y el historial necesitan poder
-- distinguirla. Esta migración reemplaza el CHECK por uno que incluye el
-- cuarto valor.
--
-- Sigue siendo nullable a propósito: los entrenamientos históricos anteriores
-- a V30 no permiten deducir con certeza de qué rutina salieron y quedan como
-- NULL ("Origen desconocido" en el calendario). No se reescribe ninguna fila.
--
-- Idempotente: se puede correr más de una vez sin efecto.

-- Por si esta base todavía no pasó por V30 (la columna se crea igual).
alter table public.entrenos
  add column if not exists routine_origin text;

do $$
begin
  -- Se elimina el CHECK de V30 (si existe) y se recrea con el valor nuevo.
  -- Hacerlo en dos pasos dentro del mismo bloque evita dejar la tabla sin
  -- restricción si algo falla en el medio: la transacción del DO revierte todo.
  if exists (
    select 1
    from pg_constraint
    where conname = 'entrenos_routine_origin_check'
      and conrelid = 'public.entrenos'::regclass
  ) then
    alter table public.entrenos
      drop constraint entrenos_routine_origin_check;
  end if;

  alter table public.entrenos
    add constraint entrenos_routine_origin_check
    check (routine_origin in ('personalizada', 'automatica', 'enfocada', 'especial') or routine_origin is null);
end $$;
