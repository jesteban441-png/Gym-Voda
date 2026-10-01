-- V40: "Mi peso" — historial de peso corporal.
--
-- Crea UNA tabla nueva con su índice y su RLS. No modifica ninguna tabla
-- existente, no toca ninguna policy existente, no borra ni migra datos, y no
-- crea buckets de Storage (las fotos de progreso NO son parte de esta fase).
--
-- `registros` sigue siendo exclusivamente el historial de pesos de EJERCICIOS.
-- El peso corporal vive acá y en ningún otro lado.
--
-- `profiles.peso_estimado` NO se toca: la columna queda tal cual, con el valor
-- que tenga cada perfil. V40 solo deja de usarla en la UI. No se migra su valor
-- a esta tabla (no tiene fecha asociada, habría que inventarla) y no hay
-- sincronización ni cache entre las dos: `peso_corporal` es la única fuente de
-- verdad del peso corporal.
--
-- Idempotente: se puede correr más de una vez sin efecto.
--
-- Convenciones del schema (auditadas en Fase 2.1):
--   * `profile_id` referencia `public.profiles(id)`, que es el `auth.uid()`.
--   * `created_at`/`updated_at` son BIGINT con epoch en MILISEGUNDOS
--     (Date.now()), igual que `registros.created_at` y `entrenos.created_at`.
--     NO son timestamptz.
--   * `fecha` es una columna propia, separada de `created_at`, igual que
--     `registros.date` — así se puede cargar un pesaje de un día anterior.
--   * Nombres en español, snake_case.
--
-- CÓMO EJECUTARLO
--   Supabase → SQL Editor → pegar este archivo completo → Run.
--   Es una sola transacción lógica; no hace falta correr nada por partes.
--   Después, correr la sección 4 (verificación, toda de lectura) y confirmar
--   que devuelve lo esperado.
--
-- MIENTRAS NO SE EJECUTE: la app no se rompe. El bloque "Mi peso" detecta que
-- la tabla no existe y muestra un aviso en vez de fallar; todo el resto de
-- Voda Fit sigue funcionando igual (ver loadProfileData en index.html).

-- ============================================================
-- 1. Tabla
-- ============================================================
create table if not exists public.peso_corporal (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  fecha       date not null,
  -- numeric(5,1): hasta 9999.9 con un decimal, la precisión que usa la UI.
  -- El CHECK descarta valores imposibles sin excluir a ninguna persona real.
  peso_kg     numeric(5,1) not null check (peso_kg > 0 and peso_kg <= 500),
  nota        text,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint
);

-- ============================================================
-- 2. Índice
-- ============================================================
-- Es exactamente el orden con el que la app lee y con el que resuelve el "peso
-- actual" (fecha desc, created_at desc).
--
-- Deliberadamente NO hay unique(profile_id, fecha): pesarse dos veces el mismo
-- día es legítimo. Con dos pesajes de la misma fecha, el actual es el de
-- created_at más alto — lo resuelve este orden, no una restricción de unicidad.
create index if not exists peso_corporal_profile_fecha_idx
  on public.peso_corporal (profile_id, fecha desc, created_at desc);

-- ============================================================
-- 3. RLS
-- ============================================================
alter table public.peso_corporal enable row level security;

-- Se recrean para que correr la migración de nuevo deje el estado deseado
-- incluso si alguien las editó a mano en el dashboard. Los DROP son solo de
-- las policies de ESTA tabla: ninguna policy existente de otra tabla se toca.
drop policy if exists peso_corporal_select on public.peso_corporal;
drop policy if exists peso_corporal_insert on public.peso_corporal;
drop policy if exists peso_corporal_update on public.peso_corporal;
drop policy if exists peso_corporal_delete on public.peso_corporal;

create policy peso_corporal_select on public.peso_corporal
  for select using (profile_id = auth.uid());

create policy peso_corporal_insert on public.peso_corporal
  for insert with check (profile_id = auth.uid());

-- El WITH CHECK del UPDATE no es decorativo: sin él se podría reasignar una
-- fila propia a otro usuario (cambiar profile_id y plantarle un registro).
create policy peso_corporal_update on public.peso_corporal
  for update using (profile_id = auth.uid())
          with check (profile_id = auth.uid());

create policy peso_corporal_delete on public.peso_corporal
  for delete using (profile_id = auth.uid());

-- ============================================================
-- 4. VERIFICACIÓN — todo de LECTURA, no cambia nada
-- ============================================================
-- Correr DESPUÉS de las secciones 1-3. Crear policies no es lo mismo que
-- confirmar que quedaron.

-- 4.1  La tabla tiene RLS habilitada y sus cuatro policies.
--      Esperado: rls_enabled = true, cantidad_policies = 4.
--
--   select
--     c.relrowsecurity    as rls_enabled,
--     count(p.policyname) as cantidad_policies
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policies p
--     on p.schemaname = n.nspname and p.tablename = c.relname
--   where n.nspname = 'public' and c.relname = 'peso_corporal'
--   group by c.relrowsecurity;

-- 4.2  Las cuatro policies, con su expresión completa.
--      Esperado: las cuatro con auth.uid() en using_expr, y el UPDATE con
--      with_check_expr NO nulo.
--
--   select policyname, cmd, permissive, roles,
--          qual as using_expr, with_check as with_check_expr
--   from pg_policies
--   where schemaname = 'public' and tablename = 'peso_corporal'
--   order by cmd, policyname;

-- 4.3  Estructura de la tabla.
--      Esperado: created_at bigint, updated_at bigint nullable,
--      peso_kg numeric(5,1) not null, fecha date not null.
--
--   select column_name, data_type, numeric_precision, numeric_scale, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'peso_corporal'
--   order by ordinal_position;

-- 4.4  El índice existe y NO hay un unique sobre (profile_id, fecha).
--
--   select indexname, indexdef
--   from pg_indexes
--   where schemaname = 'public' and tablename = 'peso_corporal';

-- 4.5  Las RLS de las tablas que ya existían siguen intactas.
--      Esperado: rls_enabled = true en las cuatro, con la misma cantidad de
--      policies que antes de correr esta migración.
--
--   select c.relname as tabla, c.relrowsecurity as rls_enabled,
--          count(p.policyname) as cantidad_policies
--   from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   left join pg_policies p
--     on p.schemaname = n.nspname and p.tablename = c.relname
--   where n.nspname = 'public'
--     and c.relname in ('profiles','rutinas','registros','entrenos')
--   group by c.relname, c.relrowsecurity
--   order by c.relname;
