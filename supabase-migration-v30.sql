-- V30: conserva el origen de las sesiones finalizadas para el calendario.
-- Es nullable a propósito: los entrenamientos históricos no permiten
-- distinguir con certeza entre rutina personalizada y automática.
alter table public.entrenos
  add column if not exists routine_origin text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'entrenos_routine_origin_check'
      and conrelid = 'public.entrenos'::regclass
  ) then
    alter table public.entrenos
      add constraint entrenos_routine_origin_check
      check (routine_origin in ('personalizada', 'automatica', 'especial') or routine_origin is null);
  end if;
end $$;
