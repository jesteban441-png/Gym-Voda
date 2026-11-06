-- V48 / 12: V51.3 — ejercicios "Omitido hoy" y ejercicios extra de la sesión.
-- PREPARADO, NO EJECUTADO. Orden: 01,02,03,07,09,04; luego ESTE archivo.
-- Requiere 07 (v48_private.nombre_canonico, usada por el v48_finalizar vigente).
--
-- Resumen del diseño (ver V51.3 — diseño definitivo, aprobado en chat):
--   - sesionActiva.day sigue siendo el ÚNICO snapshot, ahora con dos claves
--     nuevas y opcionales por ejercicio: "omitido" (boolean) y "extra"
--     (boolean, sólo informativo para la UI). Nunca se toca rutinas.data->
--     personalizada/automatica/enfocada: la rutina semanal queda intacta.
--   - v48_guardar_sesion(4 args) NO SE TOCA. Se agrega una SEGUNDA función con
--     el MISMO NOMBRE y 5 argumentos, SIN ningún DEFAULT, así que Postgres
--     nunca tiene ambigüedad de sobrecarga: una llamada con 4 argumentos
--     resuelve sólo contra la vieja, una con 5 sólo contra la nueva. (Probado:
--     agregar un p_dia DEFAULT NULL a la firma de 4 crearía una SEGUNDA
--     función que SÍ es ambigua con la original en una llamada de 4 —
--     Postgres fallaría con "is not unique" para todo cliente viejo. Por eso
--     no se usa DEFAULT acá.)
--   - v48_private.series() ahora rechaza, para CUALQUIER llamada (4 o 5
--     argumentos, guardado intermedio o v48_finalizar), que un ejercicio
--     marcado "omitido" tenga alguna serie completed=true. Es la única
--     validación de "no omitir con progreso" — alcanza para las dos
--     direcciones (intentar omitir algo ya hecho, o completar algo ya
--     omitido) porque ambas producen el mismo estado inconsistente.
--   - v48_private.validar_patch_dia() es nueva: el único cambio de día que
--     admite es agregar ids nuevos o alternar "omitido" en ids existentes.
--     Nombre/series/reps de un ejercicio ya existente no se puede editar, y
--     ningún id existente se puede remover — así ninguna serie ya tipeada
--     puede quedar huérfana.
--   - v48_finalizar: MISMA firma pública. Único cambio real: sets_totales
--     excluye las series de ejercicios omitidos. sets_completados y el loop
--     de INSERT a registros no necesitan cambiar: como "omitido" nunca puede
--     convivir con completed=true (ver series() arriba), ya quedan vacíos
--     para esos ejercicios sin ningún código nuevo. Los ejercicios "extra"
--     no necesitan ningún tratamiento especial: son una entrada más de
--     dia->'exercises', así que sus series completadas se insertan en
--     registros con el MISMO entreno_id que el resto, igual que cualquier
--     ejercicio de la rutina original.
--   - v48_private.hash_cierre: SIN CAMBIOS. La rama de reintento de
--     v48_finalizar nunca vuelve a leer sesionActiva.day (ya es NULL tras el
--     primer cierre exitoso): compara sólo (sessionId, fin, series/
--     referencias tal como las manda el cliente), exactamente igual que
--     antes de este archivo. No hay ningún escenario donde la MISMA sesión
--     pase dos veces por el cálculo de omitidos con un día distinto, así que
--     no hace falta (ni conviene) meter "omitido" en el hash.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
  IF to_regprocedure('v48_private.nombre_canonico(text)') IS NULL THEN RAISE EXCEPTION 'Falta fase 07'; END IF;
  IF to_regprocedure('public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb)') IS NULL THEN RAISE EXCEPTION 'Falta fase 02'; END IF;
END $$;

-- ===== v48_private.series: ÚNICO cambio real respecto de 02 =====
-- Se agrega, al final, el rechazo de "omitido" + completed=true conviviendo
-- para el mismo exerciseInstance. Nada más se tocó: misma firma, mismo
-- cuerpo de validación de forma/duplicados/rangos que ya existía.
CREATE OR REPLACE FUNCTION v48_private.series(p_dia jsonb,p_series jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE plan jsonb := v48_private.plan(p_dia); s jsonb; salida jsonb := '[]';
  peso numeric; reps integer; claves text[] := '{}'; clave text;
BEGIN
  IF jsonb_typeof(p_series) IS DISTINCT FROM 'array' OR octet_length(p_series::text)>1048576
    OR jsonb_array_length(p_series) <> jsonb_array_length(plan) THEN RAISE EXCEPTION 'INVALID_SETS'; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(p_series) LOOP
    IF jsonb_typeof(s) IS DISTINCT FROM 'object'
      OR jsonb_typeof(s->'completed') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(s->'setNumber') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_SET'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan) x
      WHERE x->'exerciseInstance'=s->'exerciseInstance' AND x->'setNumber'=s->'setNumber') THEN
      RAISE EXCEPTION 'UNKNOWN_SET';
    END IF;
    clave := (s->>'exerciseInstance') || ':' || (s->>'setNumber');
    IF clave=ANY(claves) THEN RAISE EXCEPTION 'DUPLICATE_SET'; END IF;
    claves := array_append(claves,clave);
    peso := NULL; reps := NULL;
    IF coalesce(s->'peso','null'::jsonb) <> 'null'::jsonb THEN
      IF jsonb_typeof(s->'peso') <> 'number' THEN RAISE EXCEPTION 'INVALID_WEIGHT'; END IF;
      peso := (s->>'peso')::numeric;
      IF peso < 0 OR peso::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'INVALID_WEIGHT'; END IF;
      peso := trim_scale(peso);
    END IF;
    IF coalesce(s->'reps','null'::jsonb) <> 'null'::jsonb THEN
      IF jsonb_typeof(s->'reps') <> 'number' OR s->>'reps' !~ '^[1-9][0-9]{0,9}$' THEN
        RAISE EXCEPTION 'INVALID_REPS';
      END IF;
      reps := (s->>'reps')::integer;
    END IF;
    IF (s->>'completed')::boolean AND (peso IS NULL OR reps IS NULL) THEN
      RAISE EXCEPTION 'COMPLETED_SET_REQUIRES_VALUES';
    END IF;
    salida := salida || jsonb_build_array(jsonb_build_object('exerciseInstance',s->>'exerciseInstance',
      'setNumber',(s->>'setNumber')::integer,'peso',peso,'reps',reps,'completed',(s->>'completed')::boolean));
  END LOOP;
  -- V51.3: un ejercicio "omitido" nunca puede tener series completed=true,
  -- sin importar si el pedido fue "omitir algo ya hecho" o "completar algo
  -- ya omitido" — las dos caras del mismo estado inconsistente.
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(salida) x
    JOIN jsonb_array_elements(p_dia->'exercises') e ON e->>'id' = x->>'exerciseInstance'
    WHERE (x->>'completed')::boolean AND coalesce((e->>'omitido')::boolean,false)
  ) THEN RAISE EXCEPTION 'OMITTED_EXERCISE_HAS_PROGRESS'; END IF;
  RETURN (SELECT jsonb_agg(value ORDER BY value->>'exerciseInstance',(value->>'setNumber')::integer)
    FROM jsonb_array_elements(salida));
END $$;
REVOKE ALL ON FUNCTION v48_private.series(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ===== v48_private.validar_patch_dia: nueva =====
-- Única transición de día permitida: agregar ids nuevos (ejercicios extra,
-- validados por forma más abajo vía plan()) o alternar "omitido" en un id
-- que ya existía. Nombre/series/reps de un existente no cambian, y ningún
-- id existente puede desaparecer — así ninguna serie ya tipeada/registrada
-- puede quedar huérfana ni reinterpretarse.
CREATE FUNCTION v48_private.validar_patch_dia(p_dia_actual jsonb,p_dia_nuevo jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; actual jsonb;
BEGIN
  IF jsonb_typeof(p_dia_nuevo) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_dia_nuevo->'exercises') IS DISTINCT FROM 'array'
    OR p_dia_nuevo->>'id' IS DISTINCT FROM p_dia_actual->>'id'
    OR p_dia_nuevo->>'nombre' IS DISTINCT FROM p_dia_actual->>'nombre' THEN
    RAISE EXCEPTION 'DAY_PATCH_INVALID';
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_dia_actual->'exercises') LOOP
    SELECT value INTO actual FROM jsonb_array_elements(p_dia_nuevo->'exercises')
      WHERE value->>'id' = e->>'id';
    IF actual IS NULL THEN RAISE EXCEPTION 'DAY_PATCH_INVALID'; END IF;
    IF actual->>'nombre' IS DISTINCT FROM e->>'nombre'
      OR actual->>'series' IS DISTINCT FROM e->>'series'
      OR coalesce(actual->>'reps','') IS DISTINCT FROM coalesce(e->>'reps','') THEN
      RAISE EXCEPTION 'DAY_PATCH_INVALID';
    END IF;
    IF actual->'omitido' IS NOT NULL AND jsonb_typeof(actual->'omitido') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'DAY_PATCH_INVALID';
    END IF;
  END LOOP;
  -- Los ids nuevos (extra) sólo necesitan pasar la validación de forma de
  -- plan() (id único/no vacío, nombre no vacío, series 1-12) — se aplica
  -- después, cuando v48_guardar_sesion llama a v48_private.series(p_dia,...).
END $$;
REVOKE ALL ON FUNCTION v48_private.validar_patch_dia(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ===== v48_guardar_sesion: SEGUNDA función, 5 argumentos, SIN default =====
-- La de 4 argumentos (02_rpc.sql) no se toca. Esta es una firma DISTINTA:
-- Postgres la resuelve sólo cuando el cliente manda exactamente 5 claves.
-- Si p_dia es NULL, delega 1:1 a la firma vieja (mismo resultado exacto,
-- cero lógica duplicada). Si p_dia trae contenido, valida la transición y
-- guarda día+sets+referencias en una sola escritura.
CREATE FUNCTION public.v48_guardar_sesion(p_revision bigint,p_sesion uuid,p_series jsonb,p_referencias jsonb,p_dia jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); s jsonb := r.data->'sesionActiva'; n jsonb; refs jsonb;
BEGIN
  IF p_dia IS NULL THEN
    RETURN public.v48_guardar_sesion(p_revision,p_sesion,p_series,p_referencias);
  END IF;
  IF s->>'sessionId' IS DISTINCT FROM p_sesion::text OR p_sesion IS NULL THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;
  PERFORM v48_private.validar_patch_dia(s->'day',p_dia);
  n := v48_private.series(p_dia,p_series);
  refs := v48_private.referencias(p_dia,n,p_referencias,false);
  IF s->'day'=p_dia AND s->'sets'=n AND s->'references'=refs THEN RETURN v48_private.respuesta(r.profile_id,p_sesion); END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  s := s || jsonb_build_object('day',p_dia,'sets',n,'references',refs);
  UPDATE public.rutinas SET data=jsonb_set(data,'{sesionActiva}',s,true) WHERE profile_id=r.profile_id;
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;
REVOKE ALL ON FUNCTION public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb) TO authenticated;

-- ===== v48_finalizar: MISMA firma pública, único cambio real en el cuerpo =====
-- sets_totales excluye las series de ejercicios omitidos. Todo lo demás
-- (sets_completados, el loop de INSERT a registros, las referencias, el
-- hash de cierre) queda textualmente igual que en 07_cierre_canonico.sql.
CREATE OR REPLACE FUNCTION public.v48_finalizar(p_revision bigint,p_sesion uuid,p_fin_ms bigint,
  p_series jsonb,p_referencias jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); s jsonb := r.data->'sesionActiva';
  c public.sesiones_v48_control; n jsonb; refs jsonb; h bytea; id_entreno uuid := gen_random_uuid();
  dia jsonb; fila jsonb; e jsonb; nombre text; fecha text; referencia jsonb;
  referencias jsonb := coalesce(r.data->'referenciasEjercicios','{}'); aceptadas jsonb := '{}';
  ahora bigint := (extract(epoch FROM clock_timestamp())*1000)::bigint;
BEGIN
  IF p_sesion IS NULL OR p_fin_ms IS NULL THEN RAISE EXCEPTION 'INVALID_CLOSE'; END IF;
  IF jsonb_typeof(p_series) IS DISTINCT FROM 'array' OR jsonb_typeof(p_referencias) IS DISTINCT FROM 'object'
    OR octet_length(p_series::text)>1048576 OR octet_length(p_referencias::text)>1048576 THEN
    RAISE EXCEPTION 'INVALID_CLOSE'; END IF;
  SELECT * INTO c FROM public.sesiones_v48_control WHERE profile_id=r.profile_id AND sesion_id=p_sesion;
  IF FOUND THEN
    IF c.estado<>'finalizada' THEN RETURN v48_private.respuesta(r.profile_id,p_sesion); END IF;
    IF jsonb_typeof(p_series) IS DISTINCT FROM 'array' OR jsonb_typeof(p_referencias) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_CLOSE'; END IF;
    SELECT jsonb_agg(value ORDER BY value->>'exerciseInstance',(value->>'setNumber')::integer)
      INTO n FROM jsonb_array_elements(p_series);
    h := v48_private.hash_cierre(p_sesion,p_fin_ms,n,p_referencias);
    IF c.contenido_sha256 IS DISTINCT FROM h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN v48_private.respuesta(r.profile_id,p_sesion);
  END IF;
  IF s->>'sessionId' IS DISTINCT FROM p_sesion::text THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_fin_ms < (s->>'startedAt')::bigint OR p_fin_ms>ahora+60000 THEN RAISE EXCEPTION 'INVALID_END_TIME'; END IF;
  dia := s->'day'; n := v48_private.series(dia,p_series);
  refs := v48_private.referencias(dia,n,p_referencias,true);
  h := v48_private.hash_cierre(p_sesion,p_fin_ms,n,refs);
  fecha := to_char(to_timestamp((s->>'startedAt')::numeric/1000) AT TIME ZONE (s->>'timezone'),'YYYY-MM-DD');
  INSERT INTO public.entrenos(id,profile_id,date,day_id,day_nombre,sets_totales,sets_completados,
    created_at,is_manual,is_special,routine_origin,sesion_id,inicio_ms,fin_ms,zona_horaria)
  VALUES(id_entreno,r.profile_id,fecha,s->>'dayId',s->>'dayNombre',
    -- V51.3: ÚNICO cambio real de esta función. Antes: jsonb_array_length(n).
    -- Ahora excluye las series de ejercicios con "omitido":true. No hace
    -- falta tocar sets_completados: un ejercicio omitido nunca puede tener
    -- completed=true (ver v48_private.series más arriba), así que ya queda
    -- en 0 sin ningún cambio.
    (SELECT count(*) FROM jsonb_array_elements(n) x
      WHERE NOT coalesce((SELECT (y->>'omitido')::boolean FROM jsonb_array_elements(dia->'exercises') y
        WHERE y->>'id'=x->>'exerciseInstance'),false)),
    (SELECT count(*) FROM jsonb_array_elements(n) x WHERE (x->>'completed')::boolean),
    ahora,false,s->>'slot'='especial',s->>'slot',p_sesion,(s->>'startedAt')::bigint,p_fin_ms,s->>'timezone');
  FOR e IN SELECT value FROM jsonb_array_elements(dia->'exercises') LOOP
    nombre := v48_private.nombre_canonico(e->>'nombre');
    FOR fila IN SELECT value FROM jsonb_array_elements(n)
      WHERE value->>'exerciseInstance'=e->>'id' AND (value->>'completed')::boolean LOOP
      INSERT INTO public.registros(id,profile_id,exercise,peso,reps,series,set_number,date,created_at,
        entreno_id,ejercicio_instancia)
      VALUES(gen_random_uuid(),r.profile_id,nombre,(fila->>'peso')::numeric,fila->>'reps','1',
        (fila->>'setNumber')::integer,fecha,ahora,id_entreno,e->>'id');
    END LOOP;
    IF coalesce((refs->(e->>'id')->>'accepted')::boolean,false) THEN
      referencia := refs->(e->>'id')->'sets';
      IF aceptadas ? nombre AND aceptadas->nombre IS DISTINCT FROM referencia THEN
        RAISE EXCEPTION 'CONFLICTING_EXERCISE_REFERENCES'; END IF;
      aceptadas := aceptadas || jsonb_build_object(nombre,referencia);
      referencias := referencias || jsonb_build_object(nombre,jsonb_build_object('series',referencia,
        'updatedAt',ahora,'sourceSessionId',p_sesion));
    END IF;
  END LOOP;
  UPDATE public.rutinas SET data=(data-'sesionActiva') || jsonb_build_object(
    'sesionActiva',NULL,'referenciasEjercicios',referencias) WHERE profile_id=r.profile_id;
  INSERT INTO public.sesiones_v48_control(profile_id,sesion_id,entreno_id,estado,contenido_sha256,creada_ms)
    VALUES(r.profile_id,p_sesion,id_entreno,'finalizada',h,ahora);
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;
-- CREATE OR REPLACE sobre una firma sin cambios conserva los GRANT ya
-- otorgados por la fase 04 (Postgres no los retira al reemplazar sólo el
-- cuerpo) — no hace falta repetir REVOKE/GRANT para v48_finalizar acá.

NOTIFY pgrst, 'reload schema';
COMMIT;
