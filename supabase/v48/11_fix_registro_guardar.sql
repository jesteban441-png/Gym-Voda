-- Corrección incremental 42702. PREPARADO, NO EJECUTADO. SOLO vodafit-staging.
-- Instalaciones existentes: aplicar tras 01,02,03,07,09,04. No reinstalar 03/09/04.
-- Instalaciones nuevas: 03 ya contiene esta corrección; este parche es redundante.
-- CREATE OR REPLACE conserva OID, owner, ACL y dependencias. No GRANT/REVOKE/DROP.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE f pg_catalog.pg_proc;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres SOLO en staging'; END IF;
 IF to_regprocedure('public.v48_registro_guardar(uuid,jsonb,boolean)') IS NULL
  OR to_regprocedure('public.v48_registro_guardar(uuid,jsonb,boolean,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Faltan las sobrecargas existentes de 03/09'; END IF;
 SELECT * INTO f FROM pg_catalog.pg_proc
  WHERE oid='public.v48_registro_guardar(uuid,jsonb,boolean)'::regprocedure;
 IF pg_get_userbyid(f.proowner)<>'postgres' OR NOT f.prosecdef
  OR f.prorettype<>'uuid'::regtype OR f.pronargdefaults<>1 THEN
  RAISE EXCEPTION 'Contrato de función inesperado; detener y revisar'; END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.v48_registro_guardar(p_id uuid,p_datos jsonb,p_editar boolean DEFAULT false)
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
NOTIFY pgrst, 'reload schema';
COMMIT;
