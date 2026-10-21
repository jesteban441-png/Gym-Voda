-- V48 compatibilidad: CAS de edición sin nuevas columnas. PREPARADO, NO EJECUTADO.
-- Orden: 01,02,03,07,09,04; luego controles/05/08. 13 firmas públicas.
-- Conserva la firma original de tres argumentos. La nueva NO tiene defaults:
-- PostgREST distingue inequívocamente llamadas con p_esperado de las anteriores.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
 IF to_regprocedure('public.v48_registro_guardar(uuid,jsonb,boolean)') IS NULL THEN RAISE EXCEPTION 'Falta fase 03'; END IF;
END $$;
CREATE FUNCTION public.v48_registro_guardar(p_id uuid,p_datos jsonb,p_editar boolean,p_esperado jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rutinas := v48_private.bloquear(); viejo public.registros; actual jsonb;
BEGIN
 IF p_editar IS DISTINCT FROM true THEN
  RETURN public.v48_registro_guardar(p_id,p_datos,p_editar);
 END IF;
 IF p_id IS NULL OR jsonb_typeof(p_datos) IS DISTINCT FROM 'object'
  OR nullif(btrim(p_datos->>'exercise'),'') IS NULL OR p_datos->>'date' IS NULL
  OR p_datos->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(p_datos->'peso') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_MANUAL_RECORD'; END IF;
 IF to_char((p_datos->>'date')::date,'YYYY-MM-DD')<>p_datos->>'date'
  OR (p_datos->>'peso')::numeric<0 OR (p_datos->>'peso')::numeric::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'INVALID_MANUAL_RECORD'; END IF;
 SELECT * INTO viejo FROM public.registros WHERE id=p_id AND profile_id=r.profile_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RECORD_NOT_FOUND'; END IF;
 IF viejo.entreno_id IS NOT NULL THEN RAISE EXCEPTION 'SESSION_RECORD_IMMUTABLE'; END IF;
 IF jsonb_typeof(p_esperado) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'EXPECTED_RECORD_REQUIRED'; END IF;
 actual:=jsonb_build_object('id',viejo.id,'profile_id',viejo.profile_id,'exercise',viejo.exercise,
   'peso',viejo.peso,'date',viejo.date,'reps',viejo.reps,'series',viejo.series,'nota',viejo.nota,
   'set_number',viejo.set_number,'created_at',viejo.created_at);
 IF actual IS DISTINCT FROM p_esperado THEN
  -- Una respuesta perdida puede dejar la fila exactamente en el destino pedido.
  IF viejo.exercise IS NOT DISTINCT FROM p_datos->>'exercise'
   AND to_jsonb(viejo.peso) IS NOT DISTINCT FROM p_datos->'peso'
   AND viejo.date IS NOT DISTINCT FROM p_datos->>'date'
   AND coalesce(viejo.reps,'')=coalesce(p_datos->>'reps','')
   AND coalesce(viejo.series,'')=coalesce(p_datos->>'series','')
   AND coalesce(viejo.nota,'')=coalesce(p_datos->>'nota','') THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'HISTORY_CONFLICT' USING ERRCODE='40001';
 END IF;
 -- Reutiliza validación/escritura y preserva set_number, created_at y vínculos.
 RETURN public.v48_registro_guardar(p_id,p_datos,true);
END $$;
REVOKE ALL ON FUNCTION public.v48_registro_guardar(uuid,jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
