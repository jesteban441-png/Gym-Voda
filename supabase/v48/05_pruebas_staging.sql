-- SOLO STAGING. No ejecutado. Ejecutar tras 01..04; nunca sobre datos reales.
-- Preparar DOS cuentas Auth sintéticas con profiles existentes, sin rutina/datos.
-- Antes del bloque DO, dentro de esta transacción, ejecutar en SQL Editor:
-- SELECT set_config('v48.test_a','UUID_DEL_PERFIL_SINTETICO_A',true);
-- SELECT set_config('v48.test_b','UUID_DEL_PERFIL_SINTETICO_B',true);
-- Esos valores son identidades de prueba, nunca credenciales. Falta -> falla segura.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- PEGAR AQUÍ los dos SELECT set_config anteriores con UUID de staging.
DO $$
DECLARE a uuid := nullif(current_setting('v48.test_a',true),'')::uuid;
        b uuid := nullif(current_setting('v48.test_b',true),'')::uuid;
        historico uuid := gen_random_uuid(); registro uuid := gen_random_uuid();
BEGIN
  IF a IS NULL OR b IS NULL OR a=b THEN RAISE EXCEPTION 'Configurar dos perfiles sintéticos de staging'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id IN(a,b))<>2 THEN RAISE EXCEPTION 'Faltan profiles de prueba'; END IF;
  IF EXISTS(SELECT 1 FROM public.rutinas WHERE profile_id IN(a,b))
    OR EXISTS(SELECT 1 FROM public.entrenos WHERE profile_id IN(a,b))
    OR EXISTS(SELECT 1 FROM public.registros WHERE profile_id IN(a,b)) THEN
    RAISE EXCEPTION 'Pruebas requieren perfiles vacíos'; END IF;
  INSERT INTO public.entrenos(id,profile_id,date,day_nombre)
    VALUES(historico,a,'2025-01-01','Fixture histórica');
  INSERT INTO public.registros(id,profile_id,exercise,date,peso,reps,series)
    VALUES(registro,a,'Dominadas','2025-01-01',0,'8-10','3');
  PERFORM set_config('v48.test_legacy_entreno',historico::text,true);
  PERFORM set_config('v48.test_legacy_registro',registro::text,true);
  PERFORM set_config('v48.test_legacy_snapshot',
    (SELECT to_jsonb(x)::text FROM public.registros x WHERE id=registro),true);
  -- Aun saltando guardas como owner, la FK impide vincular B con entreno A.
  BEGIN
    INSERT INTO public.registros(profile_id,exercise,peso,reps,series,set_number,entreno_id,ejercicio_instancia)
      VALUES(b,'Dominadas',0,'8','1',1,historico,'fixture');
    RAISE EXCEPTION 'TEST_FAIL: FK permite otro usuario';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE a uuid := current_setting('v48.test_a')::uuid; b uuid := current_setting('v48.test_b')::uuid;
  s uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); r jsonb; rev bigint; ms bigint;
  sets jsonb; refs jsonb; id_entreno uuid; primera_revision bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  -- Sesión heredada impide activación, sin convertir ni borrar.
  INSERT INTO public.rutinas(profile_id,data) VALUES(a,'{"sesionActiva":{"dayId":"legacy"}}');
  BEGIN
    PERFORM public.v48_activar(0);
    RAISE EXCEPTION 'TEST_FAIL: activó una sesión heredada';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  UPDATE public.rutinas SET data='{"personalizada":{"days":[]}}' WHERE profile_id=a;
  r := public.v48_estado();
  r := public.v48_activar((r->>'revision')::bigint);
  IF NOT (r->>'clienteV48')::boolean THEN RAISE EXCEPTION 'TEST_FAIL: no activó'; END IF;
  BEGIN
    UPDATE public.rutinas SET data='{}' WHERE profile_id=a;
    RAISE EXCEPTION 'TEST_FAIL: permitió sobrescritura antigua';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  r := public.v48_guardar_rutina((r->>'revision')::bigint,
    '{"personalizada":{"days":[{"id":"test-dia","nombre":"Fixture V48","exercises":[{"id":"test-ex","nombre":"Dominadas","series":2,"reps":"8"}]}]}}');
  ms := (extract(epoch FROM clock_timestamp())*1000)::bigint;
  r := public.v48_iniciar((r->>'revision')::bigint,s,'personalizada','test-dia',ms,'America/Montevideo');
  sets := '[{"exerciseInstance":"test-ex","setNumber":1,"peso":0,"reps":8,"completed":true},
            {"exerciseInstance":"test-ex","setNumber":2,"peso":5,"reps":6,"completed":false}]';
  refs := '{"test-ex":{"accepted":true,"sets":[{"setNumber":1,"peso":0,"reps":8}]}}';
  rev := (r->>'revision')::bigint;
  -- Marcas independientes: completar ambas y después desmarcar solo la primera.
  r := public.v48_guardar_sesion(rev,s,
    '[{"exerciseInstance":"test-ex","setNumber":1,"peso":0,"reps":8,"completed":true},
      {"exerciseInstance":"test-ex","setNumber":2,"peso":5,"reps":6,"completed":true}]','{}');
  r := public.v48_guardar_sesion((r->>'revision')::bigint,s,
    '[{"exerciseInstance":"test-ex","setNumber":1,"peso":0,"reps":8,"completed":false},
      {"exerciseInstance":"test-ex","setNumber":2,"peso":5,"reps":6,"completed":true}]','{}');
  IF NOT (r->'data'->'sesionActiva'->'sets'->1->>'completed')::boolean THEN
    RAISE EXCEPTION 'TEST_FAIL: desmarcado modificó otra serie'; END IF;
  rev := (r->>'revision')::bigint;
  r := public.v48_guardar_sesion(rev,s,sets,refs);
  primera_revision := (r->>'revision')::bigint;
  r := public.v48_guardar_sesion(rev,s,sets,refs);
  IF (r->>'revision')::bigint<>primera_revision THEN RAISE EXCEPTION 'TEST_FAIL: reintento incrementa'; END IF;
  BEGIN
    PERFORM public.v48_guardar_rutina(rev,'{"activeSlot":"automatica"}');
    RAISE EXCEPTION 'TEST_FAIL: no detectó conflicto';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  rev := (r->>'revision')::bigint;
  r := public.v48_finalizar(rev,s,ms+1000,sets,refs);
  id_entreno := (r->'terminal'->>'entrenoId')::uuid;
  IF (SELECT count(*) FROM public.registros WHERE entreno_id=id_entreno)<>1 THEN RAISE EXCEPTION 'TEST_FAIL: series incompletas insertadas'; END IF;
  IF (SELECT fin_ms-inicio_ms FROM public.entrenos WHERE id=id_entreno)<>1000 THEN RAISE EXCEPTION 'TEST_FAIL: duración'; END IF;
  r := public.v48_finalizar(rev,s,ms+1000,sets,refs);
  IF (r->'terminal'->>'entrenoId')::uuid<>id_entreno THEN RAISE EXCEPTION 'TEST_FAIL: duplicó cierre'; END IF;
  BEGIN
    PERFORM public.v48_finalizar(rev,s,ms+1001,sets,refs);
    RAISE EXCEPTION 'TEST_FAIL: aceptó payload distinto';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
  END;
  -- Otro usuario no puede consultar ni eliminar el cierre A.
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
  r := public.v48_activar(0);
  IF EXISTS(SELECT 1 FROM public.sesiones_v48_control WHERE sesion_id=s) THEN RAISE EXCEPTION 'TEST_FAIL: RLS'; END IF;
  BEGIN
    PERFORM public.v48_eliminar(s);
    RAISE EXCEPTION 'TEST_FAIL: borró usuario ajeno';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SESSION_NOT_FOUND' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  r := public.v48_eliminar(s);
  r := public.v48_eliminar(s);
  r := public.v48_finalizar(rev,s,ms+1000,sets,refs);
  IF r->'terminal'->>'estado'<>'eliminada' OR EXISTS(SELECT 1 FROM public.registros WHERE entreno_id=id_entreno) THEN
    RAISE EXCEPTION 'TEST_FAIL: borrado/resurrección'; END IF;
  IF r->'data'->'referenciasEjercicios'->'Dominadas' IS NULL THEN RAISE EXCEPTION 'TEST_FAIL: perdió referencia'; END IF;
  r := public.v48_iniciar((r->>'revision')::bigint,s2,'personalizada','test-dia',ms,'America/Montevideo');
  r := public.v48_cancelar((r->>'revision')::bigint,s2);
  r := public.v48_finalizar(0,s2,ms+1000,sets,refs);
  IF r->'terminal'->>'estado'<>'cancelada' THEN RAISE EXCEPTION 'TEST_FAIL: resucitó cancelación'; END IF;
  IF (SELECT count(*) FROM public.entrenos WHERE profile_id=a)<>1 OR (SELECT count(*) FROM public.registros WHERE profile_id=a)<>1 THEN
    RAISE EXCEPTION 'TEST_FAIL: historial residual'; END IF;
  IF (SELECT to_jsonb(x)::text FROM public.registros x WHERE id=current_setting('v48.test_legacy_registro')::uuid)
    IS DISTINCT FROM current_setting('v48.test_legacy_snapshot') THEN RAISE EXCEPTION 'TEST_FAIL: alteró histórico'; END IF;
  RAISE NOTICE 'V48 smoke: OK; todo se revierte al terminar';
END $$;
RESET ROLE;
ROLLBACK;
