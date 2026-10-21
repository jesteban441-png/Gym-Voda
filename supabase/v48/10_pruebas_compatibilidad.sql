-- Sólo staging. Prueba la sobrecarga CAS de 09 y la compatibilidad con historia.
-- PREPARADO, NO EJECUTADO. Requiere 01,02,03,07,09,04 y dos profiles sintéticos vacíos.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Pegar aquí SELECT set_config('v48.test_a','UUID_A_STAGING',true);
-- y SELECT set_config('v48.test_b','UUID_B_STAGING',true), DENTRO de esta transacción.
DO $$
DECLARE a uuid:=nullif(current_setting('v48.test_a',true),'')::uuid;
 b uuid:=nullif(current_setting('v48.test_b',true),'')::uuid; old_id uuid:=gen_random_uuid(); summary_id uuid:=gen_random_uuid();
BEGIN
 IF current_user<>'postgres' OR a IS NULL OR b IS NULL OR a=b THEN RAISE EXCEPTION 'Preparar dos usuarios sintéticos de staging'; END IF;
 IF (SELECT count(*) FROM public.profiles WHERE id IN(a,b))<>2 THEN RAISE EXCEPTION 'Faltan profiles'; END IF;
 IF EXISTS(SELECT 1 FROM public.rutinas WHERE profile_id IN(a,b))
  OR EXISTS(SELECT 1 FROM public.registros WHERE profile_id IN(a,b))
  OR EXISTS(SELECT 1 FROM public.entrenos WHERE profile_id IN(a,b)) THEN RAISE EXCEPTION 'Se requieren perfiles vacíos'; END IF;
 INSERT INTO public.registros(id,profile_id,exercise,peso,date,reps,series,nota,set_number,created_at)
 VALUES(old_id,a,'Gemelos',10,'2024-01-01','8','1','previo',2,1000);
 INSERT INTO public.entrenos(id,profile_id,date,day_nombre,sets_completados,sets_totales)
 VALUES(summary_id,a,'2024-01-01','Resumen heredado',1,1);
 PERFORM set_config('v48.compat_old',old_id::text,true);
 PERFORM set_config('v48.compat_summary',summary_id::text,true);
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE a uuid:=current_setting('v48.test_a')::uuid; b uuid:=current_setting('v48.test_b')::uuid;
 old_id uuid:=current_setting('v48.compat_old')::uuid; summary_id uuid:=current_setting('v48.compat_summary')::uuid;
 new_id uuid:=gen_random_uuid(); mark_id uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); native_id uuid; linked_id uuid;
 r jsonb; expected jsonb; ms bigint; result uuid;
 p jsonb:='{"exercise":"Gemelos parado con mancuerna","peso":0,"date":"2026-10-19","series":"3","reps":"8-12","nota":"manual"}';
 edit jsonb:='{"exercise":"Gemelos","peso":11,"date":"2024-01-01","series":"1","reps":"9","nota":"editado"}';
BEGIN
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 INSERT INTO public.rutinas(profile_id,data) VALUES(a,'{"personalizada":{"days":[{"id":"d","nombre":"Fixture compat","exercises":[{"id":"e","nombre":"Dominadas","series":"1","reps":"8"}]}]},"sesionActiva":null}');
 r:=public.v48_activar(0);
 result:=public.v48_registro_guardar(new_id,p,false,NULL);
 IF result<>new_id THEN RAISE EXCEPTION 'Alta no devuelve ID'; END IF;
 result:=public.v48_registro_guardar(new_id,p,false,NULL);
 IF (SELECT count(*) FROM public.registros WHERE id=new_id)<>1 THEN RAISE EXCEPTION 'Duplicó alta'; END IF;
 BEGIN
  PERFORM public.v48_registro_guardar(new_id,p||'{"peso":1}',false,NULL);
  RAISE EXCEPTION 'TEST_FAIL: aceptó contenido diferente';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF; END;
 -- Regresión 42702: ejecutar UPDATE real por la firma de tres argumentos.
 -- Cambiar peso y fecha demuestra que no se asigna la columna a sí misma.
 result:=public.v48_registro_guardar(new_id,p||'{"peso":2,"date":"2026-10-20"}',true);
 IF result IS DISTINCT FROM new_id OR NOT EXISTS(SELECT 1 FROM public.registros
  WHERE id=new_id AND peso=2 AND date='2026-10-20') THEN
  RAISE EXCEPTION 'TEST_FAIL: regresión UPDATE firma 3 argumentos'; END IF;
 result:=public.v48_registro_guardar(new_id,p,true);
 IF result IS DISTINCT FROM new_id OR NOT EXISTS(SELECT 1 FROM public.registros
  WHERE id=new_id AND peso=0 AND date='2026-10-19') THEN
  RAISE EXCEPTION 'TEST_FAIL: regresión edición a carga cero'; END IF;
 -- La firma CAS debe llegar al mismo UPDATE y conservar sus reintentos/conflictos.
 SELECT to_jsonb(x) INTO expected FROM (SELECT id,profile_id,exercise,peso,date,reps,series,nota,set_number,created_at
  FROM public.registros WHERE id=old_id) x;
 PERFORM public.v48_registro_guardar(old_id,edit,true,expected);
 PERFORM public.v48_registro_guardar(old_id,edit,true,expected); -- respuesta perdida, mismo destino
 IF NOT EXISTS(SELECT 1 FROM public.registros WHERE id=old_id AND exercise='Gemelos' AND peso=11 AND created_at=1000 AND set_number=2)
 THEN RAISE EXCEPTION 'Reescribió identidad o metadatos históricos'; END IF;
 BEGIN
  PERFORM public.v48_registro_guardar(old_id,edit||'{"peso":12}',true,expected);
  RAISE EXCEPTION 'TEST_FAIL: sobrescribió cambio concurrente';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.v48_marcar_dia(mark_id,'2026-10-19','Manual sintético');
 PERFORM public.v48_marcar_dia(mark_id,'2026-10-19','Manual sintético');
 IF NOT EXISTS(SELECT 1 FROM public.entrenos WHERE id=mark_id AND is_manual AND sets_completados=0 AND sesion_id IS NULL)
 THEN RAISE EXCEPTION 'Marcado manual incorrecto'; END IF;
 PERFORM public.v48_historico_eliminar(summary_id);
 IF NOT EXISTS(SELECT 1 FROM public.registros WHERE id=old_id) THEN RAISE EXCEPTION 'Borrar resumen eliminó registro sin vínculo'; END IF;
 r:=public.v48_estado();ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 r:=public.v48_iniciar((r->>'revision')::bigint,sid,'personalizada','d',ms,'America/Montevideo');
 r:=public.v48_finalizar((r->>'revision')::bigint,sid,ms+1000,
 '[{"exerciseInstance":"e","setNumber":1,"peso":0,"reps":8,"completed":true}]',
 '{"e":{"accepted":false,"sets":[{"setNumber":1,"peso":0,"reps":8}]}}');
 native_id:=(r->'terminal'->>'entrenoId')::uuid;
 SELECT id INTO linked_id FROM public.registros WHERE entreno_id=native_id;
 BEGIN
  PERFORM public.v48_registro_guardar(linked_id,edit,true,'{}');RAISE EXCEPTION 'TEST_FAIL: editó serie nativa';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SESSION_RECORD_IMMUTABLE' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.v48_registro_eliminar(linked_id);RAISE EXCEPTION 'TEST_FAIL: borró serie nativa';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DELETE_WHOLE_SESSION_REQUIRED' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.v48_historico_eliminar(native_id);RAISE EXCEPTION 'TEST_FAIL: borró nativo por ruta heredada';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'USE_V48_ELIMINAR' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 INSERT INTO public.rutinas(profile_id,data) VALUES(b,'{}');PERFORM public.v48_activar(0);
 BEGIN
  PERFORM public.v48_registro_guardar(old_id,edit,true,expected);RAISE EXCEPTION 'TEST_FAIL: editó usuario ajeno';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECORD_NOT_FOUND' THEN RAISE; END IF; END;
 PERFORM public.v48_registro_eliminar(new_id); -- ausencia propia: no borra A
 IF EXISTS(SELECT 1 FROM public.registros WHERE id=new_id) THEN RAISE EXCEPTION 'RLS expuso registro A'; END IF;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 IF NOT EXISTS(SELECT 1 FROM public.registros WHERE id=new_id) THEN RAISE EXCEPTION 'B borró A'; END IF;
 PERFORM public.v48_eliminar(sid);
 IF EXISTS(SELECT 1 FROM public.registros WHERE entreno_id=native_id) THEN RAISE EXCEPTION 'No eliminó series vinculadas'; END IF;
 PERFORM public.v48_registro_eliminar(old_id);PERFORM public.v48_registro_eliminar(old_id);
 IF has_function_privilege('anon','public.v48_registro_guardar(uuid,jsonb,boolean,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'EXECUTE anon'; END IF;
 IF NOT has_function_privilege('authenticated','public.v48_registro_guardar(uuid,jsonb,boolean,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Falta EXECUTE autenticado'; END IF;
 RAISE NOTICE 'V48 compat smoke: OK; se revierte todo';
END $$;
RESET ROLE;
ROLLBACK;
