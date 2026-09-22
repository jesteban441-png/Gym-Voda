-- V30: conserva el origen de las sesiones finalizadas para el calendario.
-- Es nullable a propósito: los entrenamientos históricos no permiten
-- distinguir con certeza entre rutina personalizada y automática.
alter table public.entrenos
  add column if not exists routine_origin text;
