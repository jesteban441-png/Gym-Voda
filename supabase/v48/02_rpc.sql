-- V48 / 02: RPC instaladas pero NO concedidas al cliente hasta 04.
-- Ejecutar una vez como postgres, después de 01. NO ejecutado por Codex.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF; END $$;

CREATE FUNCTION v48_private.usuario() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE u uuid := auth.uid();
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN u;
END $$;

CREATE FUNCTION v48_private.bloquear(p_activado boolean DEFAULT true) RETURNS public.rutinas
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u uuid := v48_private.usuario(); r public.rutinas;
BEGIN
  INSERT INTO public.rutinas(profile_id) VALUES(u) ON CONFLICT(profile_id) DO NOTHING;
  SELECT * INTO STRICT r FROM public.rutinas WHERE profile_id=u FOR UPDATE;
  IF p_activado AND NOT r.cliente_v48 THEN
    RAISE EXCEPTION 'V48_NOT_ACTIVATED' USING ERRCODE='55000';
  END IF;
  RETURN r;
END $$;

CREATE FUNCTION v48_private.respuesta(p_usuario uuid, p_sesion uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object('revision', r.revision, 'clienteV48', r.cliente_v48,
    'data', r.data, 'terminal', (
      SELECT jsonb_build_object('sessionId',sesion_id,'entrenoId',entreno_id,'estado',estado)
      FROM public.sesiones_v48_control WHERE profile_id=p_usuario AND sesion_id=p_sesion
    )) FROM public.rutinas r WHERE r.profile_id=p_usuario
$$;

-- Mismas 1..12 series que la sesión actual; identificadores locales de la rutina.
CREATE FUNCTION v48_private.plan(p_dia jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; n integer; i integer; salida jsonb := '[]'; ids text[] := '{}';
BEGIN
  IF jsonb_typeof(p_dia) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_dia->'exercises') IS DISTINCT FROM 'array'
    OR octet_length(p_dia::text)>1048576 THEN RAISE EXCEPTION 'INVALID_DAY'; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_dia->'exercises') LOOP
    IF nullif(btrim(e->>'id'),'') IS NULL OR nullif(btrim(e->>'nombre'),'') IS NULL
      OR (e->>'id') = ANY(ids) THEN RAISE EXCEPTION 'INVALID_EXERCISE_INSTANCE'; END IF;
    ids := array_append(ids,e->>'id');
    n := CASE WHEN e->>'series' ~ '^[0-9]{1,4}$'
      THEN greatest(1,least(12,(e->>'series')::integer)) ELSE 1 END;
    FOR i IN 1..n LOOP
      salida := salida || jsonb_build_array(jsonb_build_object('exerciseInstance',e->>'id',
        'setNumber',i,'peso',NULL,'reps',NULL,'completed',false));
    END LOOP;
  END LOOP;
  IF jsonb_array_length(salida)=0 THEN RAISE EXCEPTION 'EMPTY_DAY'; END IF;
  RETURN salida;
END $$;

CREATE FUNCTION v48_private.series(p_dia jsonb,p_series jsonb) RETURNS jsonb
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
  RETURN (SELECT jsonb_agg(value ORDER BY value->>'exerciseInstance',(value->>'setNumber')::integer)
    FROM jsonb_array_elements(salida));
END $$;

-- Decisiones: { exId: {accepted:boolean, sets:[{setNumber,peso,reps}, ...]} }.
-- La instantánea exacta evita aplicar referencias aceptadas antes de una edición.
CREATE FUNCTION v48_private.referencias(p_dia jsonb,p_series jsonb,p_refs jsonb,p_final boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE e jsonb; referencia jsonb; completadas jsonb; salida jsonb := '{}'; k text;
BEGIN
  IF jsonb_typeof(p_refs) IS DISTINCT FROM 'object' OR octet_length(p_refs::text)>1048576 THEN
    RAISE EXCEPTION 'INVALID_REFERENCE_DECISIONS';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_refs) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_dia->'exercises') x WHERE x->>'id'=k) THEN
      RAISE EXCEPTION 'UNKNOWN_REFERENCE_INSTANCE'; END IF;
  END LOOP;
  FOR e IN SELECT value FROM jsonb_array_elements(p_dia->'exercises') LOOP
    SELECT coalesce(jsonb_agg(value-'exerciseInstance'-'completed' ORDER BY (value->>'setNumber')::integer),'[]')
      INTO completadas FROM jsonb_array_elements(p_series)
      WHERE value->>'exerciseInstance'=e->>'id' AND (value->>'completed')::boolean;
    referencia := p_refs->(e->>'id');
    IF referencia IS NULL THEN
      IF p_final AND jsonb_array_length(completadas)>0 THEN RAISE EXCEPTION 'REFERENCE_DECISION_REQUIRED'; END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(referencia->'accepted') IS DISTINCT FROM 'boolean'
      OR referencia->'sets' IS DISTINCT FROM completadas
      OR jsonb_array_length(completadas)=0 THEN RAISE EXCEPTION 'STALE_REFERENCE_DECISION'; END IF;
    salida := salida || jsonb_build_object(e->>'id',jsonb_build_object(
      'accepted',(referencia->>'accepted')::boolean,'sets',completadas));
  END LOOP;
  RETURN salida;
END $$;

CREATE FUNCTION public.v48_estado(p_sesion uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u uuid := v48_private.usuario();
BEGIN RETURN v48_private.respuesta(u,p_sesion); END $$;

CREATE FUNCTION public.v48_activar(p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(false);
BEGIN
  IF r.cliente_v48 THEN RETURN v48_private.respuesta(r.profile_id); END IF;
  IF jsonb_typeof(r.data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_ROUTINE_STATE'; END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF coalesce(r.data->'sesionActiva','null'::jsonb) <> 'null'::jsonb THEN
    RAISE EXCEPTION 'LEGACY_SESSION_MUST_BE_FINISHED' USING ERRCODE='55000'; END IF;
  UPDATE public.rutinas SET cliente_v48=true WHERE profile_id=r.profile_id;
  RETURN v48_private.respuesta(r.profile_id);
END $$;

-- Preserva claves protegidas y desconocidas; el cliente envía patch de rutinas.
CREATE FUNCTION public.v48_guardar_rutina(p_revision bigint,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); k text;
BEGIN
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR octet_length(p_patch::text)>1048576 THEN RAISE EXCEPTION 'INVALID_PATCH'; END IF;
  FOR k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF k NOT IN ('personalizada','automatica','enfocada','activeSlot') THEN RAISE EXCEPTION 'PROTECTED_KEY'; END IF;
    IF k='activeSlot' THEN
      IF jsonb_typeof(p_patch->k) IS DISTINCT FROM 'string'
        OR p_patch->>k NOT IN ('personalizada','automatica','enfocada') THEN RAISE EXCEPTION 'INVALID_SLOT'; END IF;
    ELSIF jsonb_typeof(p_patch->k) IS DISTINCT FROM 'object'
      OR jsonb_typeof(p_patch->k->'days') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INVALID_ROUTINE_SLOT';
    END IF;
  END LOOP;
  UPDATE public.rutinas SET data=data || p_patch WHERE profile_id=r.profile_id;
  RETURN v48_private.respuesta(r.profile_id);
END $$;

CREATE FUNCTION public.v48_iniciar(p_revision bigint,p_sesion uuid,p_slot text,p_dia_id text,
  p_inicio_ms bigint,p_zona text,p_dia_especial jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); dia jsonb; sesion jsonb; previo jsonb := r.data->'sesionActiva';
BEGIN
  IF p_sesion IS NULL OR p_slot IS NULL OR p_slot NOT IN ('personalizada','automatica','enfocada','especial')
    OR nullif(p_dia_id,'') IS NULL THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF EXISTS(SELECT 1 FROM public.sesiones_v48_control WHERE profile_id=r.profile_id AND sesion_id=p_sesion) THEN
    RAISE EXCEPTION 'SESSION_TERMINAL'; END IF;
  IF coalesce(previo,'null'::jsonb) <> 'null'::jsonb THEN
    IF previo->>'sessionId'=p_sesion::text AND previo->>'slot'=p_slot AND previo->>'dayId'=p_dia_id
      AND (previo->>'startedAt')::bigint=p_inicio_ms AND previo->>'timezone'=p_zona THEN
      RETURN v48_private.respuesta(r.profile_id,p_sesion);
    END IF;
    RAISE EXCEPTION 'ACTIVE_SESSION_EXISTS';
  END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  IF p_inicio_ms IS NULL OR p_inicio_ms<=0 OR p_inicio_ms>(extract(epoch FROM clock_timestamp())*1000)::bigint+60000
    OR p_zona IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_zona) THEN
    RAISE EXCEPTION 'INVALID_START_TIME'; END IF;
  IF p_slot='especial' THEN
    dia := p_dia_especial;
  ELSE
    SELECT value INTO dia FROM jsonb_array_elements(coalesce(r.data->p_slot->'days','[]'))
      WHERE value->>'id'=p_dia_id;
  END IF;
  IF dia IS NULL OR dia->>'id' IS DISTINCT FROM p_dia_id THEN RAISE EXCEPTION 'DAY_NOT_FOUND'; END IF;
  sesion := jsonb_build_object('schemaVersion',48,'sessionId',p_sesion,'slot',p_slot,
    'dayId',p_dia_id,'dayNombre',dia->>'nombre','startedAt',p_inicio_ms,'timezone',p_zona,
    'day',dia,'sets',v48_private.series(dia,v48_private.plan(dia)),'references','{}'::jsonb);
  UPDATE public.rutinas SET data=jsonb_set(data,'{sesionActiva}',sesion,true) WHERE profile_id=r.profile_id;
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;

CREATE FUNCTION public.v48_guardar_sesion(p_revision bigint,p_sesion uuid,p_series jsonb,p_referencias jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); s jsonb := r.data->'sesionActiva'; n jsonb; refs jsonb;
BEGIN
  IF s->>'sessionId' IS DISTINCT FROM p_sesion::text OR p_sesion IS NULL THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;
  n := v48_private.series(s->'day',p_series);
  refs := v48_private.referencias(s->'day',n,p_referencias,false);
  IF s->'sets'=n AND s->'references'=refs THEN RETURN v48_private.respuesta(r.profile_id,p_sesion); END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  s := s || jsonb_build_object('sets',n,'references',refs);
  UPDATE public.rutinas SET data=jsonb_set(data,'{sesionActiva}',s,true) WHERE profile_id=r.profile_id;
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;

-- Hash solo del contenido final; no incluye revisión, orden de arrays ni datos de transporte.
CREATE FUNCTION v48_private.hash_cierre(p_sesion uuid,p_fin bigint,p_series jsonb,p_refs jsonb) RETURNS bytea
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE n jsonb; refs jsonb := '{}'; k text; v jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object('exerciseInstance',value->>'exerciseInstance',
    'setNumber',(value->>'setNumber')::integer,'peso',trim_scale((value->>'peso')::numeric),
    'reps',(value->>'reps')::integer,'completed',(value->>'completed')::boolean)
    ORDER BY value->>'exerciseInstance',(value->>'setNumber')::integer)
    INTO n FROM jsonb_array_elements(p_series);
  FOR k,v IN SELECT key,value FROM jsonb_each(p_refs) LOOP
    refs := refs || jsonb_build_object(k,jsonb_build_object('accepted',(v->>'accepted')::boolean,
      'sets',(SELECT jsonb_agg(jsonb_build_object('setNumber',(value->>'setNumber')::integer,
        'peso',trim_scale((value->>'peso')::numeric),'reps',(value->>'reps')::integer)
        ORDER BY (value->>'setNumber')::integer) FROM jsonb_array_elements(v->'sets'))));
  END LOOP;
  RETURN extensions.digest(jsonb_build_object('sessionId',p_sesion,'fin',p_fin,
    'sets',n,'references',refs)::text,'sha256');
END
$$;

CREATE FUNCTION public.v48_finalizar(p_revision bigint,p_sesion uuid,p_fin_ms bigint,
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
    -- Canonicalizar el payload para comparar sin necesitar el borrador eliminado.
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
  VALUES(id_entreno,r.profile_id,fecha,s->>'dayId',s->>'dayNombre',jsonb_array_length(n),
    (SELECT count(*) FROM jsonb_array_elements(n) x WHERE (x->>'completed')::boolean),
    ahora,false,s->>'slot'='especial',s->>'slot',p_sesion,(s->>'startedAt')::bigint,p_fin_ms,s->>'timezone');
  FOR e IN SELECT value FROM jsonb_array_elements(dia->'exercises') LOOP
    nombre := e->>'nombre';
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

CREATE FUNCTION public.v48_cancelar(p_revision bigint,p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear();
BEGIN
  IF p_sesion IS NULL THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
  IF EXISTS(SELECT 1 FROM public.sesiones_v48_control WHERE profile_id=r.profile_id AND sesion_id=p_sesion) THEN
    RETURN v48_private.respuesta(r.profile_id,p_sesion); END IF;
  IF r.data->'sesionActiva'->>'sessionId' IS DISTINCT FROM p_sesion::text THEN RAISE EXCEPTION 'SESSION_NOT_ACTIVE'; END IF;
  IF r.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  UPDATE public.rutinas SET data=jsonb_set(data,'{sesionActiva}','null',true) WHERE profile_id=r.profile_id;
  INSERT INTO public.sesiones_v48_control(profile_id,sesion_id,estado,creada_ms)
    VALUES(r.profile_id,p_sesion,'cancelada',(extract(epoch FROM clock_timestamp())*1000)::bigint);
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;

CREATE FUNCTION public.v48_eliminar(p_sesion uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); c public.sesiones_v48_control;
BEGIN
  SELECT * INTO c FROM public.sesiones_v48_control WHERE profile_id=r.profile_id AND sesion_id=p_sesion;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF c.estado<>'finalizada' THEN RETURN v48_private.respuesta(r.profile_id,p_sesion); END IF;
  DELETE FROM public.entrenos WHERE id=c.entreno_id AND profile_id=r.profile_id AND sesion_id=p_sesion;
  IF NOT FOUND THEN RAISE EXCEPTION 'TERMINAL_INTEGRITY_ERROR'; END IF;
  UPDATE public.sesiones_v48_control SET estado='eliminada',
    eliminada_ms=greatest(creada_ms,(extract(epoch FROM clock_timestamp())*1000)::bigint)
    WHERE profile_id=r.profile_id AND sesion_id=p_sesion;
  RETURN v48_private.respuesta(r.profile_id,p_sesion);
END $$;

-- Retirar TODOS los grants heredados de defaults en la misma transacción.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname LIKE 'v48\_%' ESCAPE '\') OR n.nspname='v48_private' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.firma);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
