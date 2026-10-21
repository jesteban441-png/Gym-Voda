-- V48 / 03: escritura manual/histórica para cuentas V48. No se convierte historia.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF; END $$;

CREATE FUNCTION public.v48_registro_guardar(p_id uuid,p_datos jsonb,p_editar boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); viejo public.registros; v_fecha text := p_datos->>'date'; v_peso numeric;
BEGIN
  IF p_id IS NULL OR p_editar IS NULL OR jsonb_typeof(p_datos) IS DISTINCT FROM 'object'
    OR nullif(btrim(p_datos->>'exercise'),'') IS NULL OR v_fecha IS NULL
    OR v_fecha !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_MANUAL_RECORD'; END IF;
  IF to_char(v_fecha::date,'YYYY-MM-DD')<>v_fecha OR jsonb_typeof(p_datos->'peso') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'INVALID_MANUAL_RECORD'; END IF;
  v_peso := (p_datos->>'peso')::numeric;
  IF v_peso<0 OR v_peso::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'INVALID_WEIGHT'; END IF;
  SELECT * INTO viejo FROM public.registros WHERE id=p_id AND profile_id=r.profile_id;
  IF FOUND THEN
    IF viejo.entreno_id IS NOT NULL THEN RAISE EXCEPTION 'SESSION_RECORD_IMMUTABLE'; END IF;
    IF NOT p_editar THEN
      IF viejo.exercise=p_datos->>'exercise' AND viejo.date=v_fecha AND viejo.peso=v_peso
        AND coalesce(viejo.reps,'')=coalesce(p_datos->>'reps','')
        AND coalesce(viejo.series,'')=coalesce(p_datos->>'series','')
        AND coalesce(viejo.nota,'')=coalesce(p_datos->>'nota','') THEN RETURN p_id; END IF;
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    UPDATE public.registros SET exercise=p_datos->>'exercise',date=v_fecha,peso=v_peso,
      reps=coalesce(p_datos->>'reps',''),series=coalesce(p_datos->>'series',''),nota=coalesce(p_datos->>'nota','')
      WHERE id=p_id AND profile_id=r.profile_id AND entreno_id IS NULL;
  ELSE
    IF p_editar THEN RAISE EXCEPTION 'RECORD_NOT_FOUND'; END IF;
    INSERT INTO public.registros(id,profile_id,exercise,peso,date,reps,series,nota,created_at)
      VALUES(p_id,r.profile_id,p_datos->>'exercise',v_peso,v_fecha,coalesce(p_datos->>'reps',''),
        coalesce(p_datos->>'series',''),coalesce(p_datos->>'nota',''),(extract(epoch FROM clock_timestamp())*1000)::bigint);
  END IF;
  RETURN p_id;
END $$;

CREATE FUNCTION public.v48_registro_eliminar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear();
BEGIN
  IF EXISTS(SELECT 1 FROM public.registros WHERE id=p_id AND profile_id=r.profile_id AND entreno_id IS NOT NULL) THEN
    RAISE EXCEPTION 'DELETE_WHOLE_SESSION_REQUIRED'; END IF;
  DELETE FROM public.registros WHERE id=p_id AND profile_id=r.profile_id AND entreno_id IS NULL;
END $$;

CREATE FUNCTION public.v48_marcar_dia(p_id uuid,p_fecha text,p_nombre text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); viejo public.entrenos;
BEGIN
  IF p_id IS NULL OR p_fecha IS NULL OR p_fecha !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    OR p_nombre IS NULL OR btrim(p_nombre)='' THEN RAISE EXCEPTION 'INVALID_MANUAL_DAY'; END IF;
  IF to_char(p_fecha::date,'YYYY-MM-DD')<>p_fecha THEN RAISE EXCEPTION 'INVALID_MANUAL_DAY'; END IF;
  SELECT * INTO viejo FROM public.entrenos WHERE profile_id=r.profile_id AND id=p_id;
  IF FOUND THEN
    IF viejo.is_manual AND viejo.sesion_id IS NULL AND viejo.date=p_fecha AND viejo.day_nombre=p_nombre THEN RETURN p_id; END IF;
    RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
  END IF;
  INSERT INTO public.entrenos(id,profile_id,date,day_nombre,sets_completados,sets_totales,is_manual,created_at)
    VALUES(p_id,r.profile_id,p_fecha,p_nombre,0,0,true,(extract(epoch FROM clock_timestamp())*1000)::bigint);
  RETURN p_id;
END $$;

CREATE FUNCTION public.v48_historico_eliminar(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear();
BEGIN
  IF EXISTS(SELECT 1 FROM public.entrenos WHERE id=p_id AND profile_id=r.profile_id AND sesion_id IS NOT NULL) THEN
    RAISE EXCEPTION 'USE_V48_ELIMINAR'; END IF;
  -- Comportamiento previo: borrar resumen histórico no borra registros sin vínculo.
  DELETE FROM public.entrenos WHERE id=p_id AND profile_id=r.profile_id AND sesion_id IS NULL;
END $$;

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('v48_registro_guardar','v48_registro_eliminar','v48_marcar_dia','v48_historico_eliminar') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.firma);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
