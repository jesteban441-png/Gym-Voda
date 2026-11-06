-- SOLO STAGING. Prueba 12_omitidos_extras.sql. PREPARADO, NO EJECUTADO.
-- Requiere 01,02,03,07,09,04,12 y dos profiles sintéticos vacíos (mismo
-- requisito que 10_pruebas_compatibilidad.sql). Termina en ROLLBACK: no deja
-- ningún dato, ni siquiera si todas las aserciones pasan.
--
-- Antes del bloque DO, DENTRO de esta transacción, ejecutar en SQL Editor:
-- SELECT set_config('v48.test_a','UUID_A_STAGING',true);
-- SELECT set_config('v48.test_b','UUID_B_STAGING',true);
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$
DECLARE a uuid:=nullif(current_setting('v48.test_a',true),'')::uuid;
 b uuid:=nullif(current_setting('v48.test_b',true),'')::uuid;
BEGIN
 IF current_user<>'postgres' OR a IS NULL OR b IS NULL OR a=b THEN RAISE EXCEPTION 'Preparar dos usuarios sintéticos de staging'; END IF;
 IF (SELECT count(*) FROM public.profiles WHERE id IN(a,b))<>2 THEN RAISE EXCEPTION 'Faltan profiles'; END IF;
 IF EXISTS(SELECT 1 FROM public.rutinas WHERE profile_id IN(a,b))
  OR EXISTS(SELECT 1 FROM public.registros WHERE profile_id IN(a,b))
  OR EXISTS(SELECT 1 FROM public.entrenos WHERE profile_id IN(a,b)) THEN RAISE EXCEPTION 'Se requieren perfiles vacíos'; END IF;
 IF to_regprocedure('public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb)') IS NULL THEN RAISE EXCEPTION 'Falta fase 12'; END IF;
 -- V51.3: el fixture "cierre anterior a la migración" (prueba 8b, más abajo)
 -- se arma ACÁ, como postgres, por DOS razones: v48_private no tiene
 -- USAGE/EXECUTE para authenticated (a propósito), y sesiones_v48_control
 -- sólo le da SELECT a authenticated (ver 04_activar_acceso.sql) — un INSERT
 -- directo ahí bajo authenticated fallaría con "permission denied" igual que
 -- llamar a v48_private directamente. Al bloque de abajo sólo se llevan los
 -- valores que un cliente real le mandaría a v48_finalizar() — nunca el hash.
 DECLARE sesion_viejo_id uuid:=gen_random_uuid(); ms_viejo bigint:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
  n_viejo jsonb:='[{"exerciseInstance":"solo","setNumber":1,"peso":20,"reps":10,"completed":true}]';
  h_viejo bytea; entreno_viejo_id uuid:=gen_random_uuid();
 BEGIN
  h_viejo:=v48_private.hash_cierre(sesion_viejo_id,ms_viejo+5000,n_viejo,'{}');
  INSERT INTO public.entrenos(id,profile_id,date,day_nombre,sets_totales,sets_completados)
    VALUES(entreno_viejo_id,a,'2024-06-01','Fixture pre-migración',1,1);
  INSERT INTO public.sesiones_v48_control(profile_id,sesion_id,entreno_id,estado,contenido_sha256,creada_ms)
    VALUES(a,sesion_viejo_id,entreno_viejo_id,'finalizada',h_viejo,ms_viejo+5000);
  PERFORM set_config('v48.test_sesion_viejo',sesion_viejo_id::text,true);
  PERFORM set_config('v48.test_ms_viejo',ms_viejo::text,true);
  PERFORM set_config('v48.test_entreno_viejo',entreno_viejo_id::text,true);
 END;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE a uuid:=current_setting('v48.test_a')::uuid; b uuid:=current_setting('v48.test_b')::uuid;
 sid uuid:=gen_random_uuid(); r jsonb; ms bigint; rev bigint;
 dia0 jsonb:='{"id":"d","nombre":"Día fixture","exercises":[
   {"id":"e1","nombre":"Press de banca con barra","series":"4","reps":"10"},
   {"id":"e2","nombre":"Remo con barra","series":"2","reps":"10"}]}';
 dia_omitir_e1_con_progreso jsonb; dia_omitir_e2 jsonb; dia_restaurar_e2 jsonb;
 dia_con_extra jsonb; dia_remueve jsonb; dia_edita jsonb;
 series0 jsonb; series_e1_parcial jsonb; series_e2_omitido jsonb; series_con_extra jsonb;
 series_final jsonb; series_final_sin_extra jsonb;
 v_entreno uuid; n_filas int;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 -- V51.3: el literal anterior usaba un día "d" con exercises:[] — DISTINTO de
 -- dia0 (declarado arriba, con e1/e2) — así que v48_private.plan() lo
 -- rechazaba con EMPTY_DAY al iniciar la sesión. Se construye la rutina con
 -- jsonb_build_object a partir de la MISMA variable dia0 que usan las 11
 -- pruebas de abajo, para que el día que de verdad arranca la sesión sea el
 -- que después se compara/parchea/omite — nunca un stub aparte.
 INSERT INTO public.rutinas(profile_id,data) VALUES(a,
   jsonb_build_object('personalizada',jsonb_build_object('days',jsonb_build_array(dia0)),
     'sesionActiva','null'::jsonb));
 r:=public.v48_activar(0); rev:=(r->>'revision')::bigint;
 ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 r:=public.v48_iniciar(rev,sid,'personalizada','d',ms,'America/Montevideo'); rev:=(r->>'revision')::bigint;

 -- ---------- 1: compatibilidad de la llamada vieja de 4 argumentos ----------
 series0:='[{"exerciseInstance":"e1","setNumber":1,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e1","setNumber":2,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e1","setNumber":3,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e1","setNumber":4,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e2","setNumber":1,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e2","setNumber":2,"peso":null,"reps":null,"completed":false}]';
 series_e1_parcial:='[{"exerciseInstance":"e1","setNumber":1,"peso":40,"reps":10,"completed":true},
   {"exerciseInstance":"e1","setNumber":2,"peso":42,"reps":8,"completed":true},
   {"exerciseInstance":"e1","setNumber":3,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e1","setNumber":4,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e2","setNumber":1,"peso":null,"reps":null,"completed":false},
   {"exerciseInstance":"e2","setNumber":2,"peso":null,"reps":null,"completed":false}]';
 r:=public.v48_guardar_sesion(rev,sid,series_e1_parcial,'{}'); rev:=(r->>'revision')::bigint;
 IF (r->'data'->'sesionActiva'->'sets') IS DISTINCT FROM series_e1_parcial THEN
   RAISE EXCEPTION 'TEST_FAIL: la función de 4 argumentos no guardó las series'; END IF;
 IF (r->'data'->'sesionActiva'->'day') IS DISTINCT FROM dia0 THEN
   RAISE EXCEPTION 'TEST_FAIL: la de 4 argumentos no puede tocar el día'; END IF;

 -- ---------- 4 (caso obligatorio): no se puede omitir con progreso ----------
 dia_omitir_e1_con_progreso:=jsonb_set(dia0,'{exercises,0,omitido}','true'::jsonb);
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e1_parcial,'{}',dia_omitir_e1_con_progreso);
   RAISE EXCEPTION 'TEST_FAIL: aceptó omitir un ejercicio con series completadas';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'OMITTED_EXERCISE_HAS_PROGRESS' THEN RAISE; END IF; END;
 -- La sesión no debe haber cambiado por el intento rechazado.
 r:=public.v48_estado(sid);
 IF (r->'data'->'sesionActiva'->'sets') IS DISTINCT FROM series_e1_parcial THEN
   RAISE EXCEPTION 'TEST_FAIL: el intento rechazado modificó las series guardadas'; END IF;

 -- ---------- 5: dejar series pendientes y continuar NO es omitir ----------
 -- e1 sigue 2/4, nunca se tocó "omitido": tiene que poder seguir guardándose
 -- con la función de 4 argumentos sin que nada lo interprete como omisión.
 r:=public.v48_guardar_sesion(rev,sid,series_e1_parcial,'{}'); rev:=(r->>'revision')::bigint;
 IF coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->0->>'omitido')::boolean,false) THEN
   RAISE EXCEPTION 'TEST_FAIL: dejar series pendientes no puede marcar omitido solo'; END IF;

 -- ---------- 2 y 3: omitir e2 (sin progreso) vía la firma de 5 ----------
 dia_omitir_e2:=jsonb_set(dia0,'{exercises,1,omitido}','true'::jsonb);
 series_e2_omitido:=series_e1_parcial; -- e2 sigue sin ninguna serie completada
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_omitir_e2); rev:=(r->>'revision')::bigint;
 IF NOT coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->1->>'omitido')::boolean,false) THEN
   RAISE EXCEPTION 'TEST_FAIL: e2 debería quedar omitido'; END IF;

 -- Restaurar e2 (requisito 3 del producto): vuelve a omitido:false sin perder nada.
 dia_restaurar_e2:=jsonb_set(dia_omitir_e2,'{exercises,1,omitido}','false'::jsonb);
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_restaurar_e2); rev:=(r->>'revision')::bigint;
 IF coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->1->>'omitido')::boolean,true) THEN
   RAISE EXCEPTION 'TEST_FAIL: restaurar e2 no funcionó'; END IF;
 -- Y lo volvemos a omitir para el resto del escenario (e2 queda omitido hasta finalizar).
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_omitir_e2); rev:=(r->>'revision')::bigint;

 -- ---------- 3: el patch de día rechaza remover o editar lo existente ----------
 dia_remueve:=jsonb_set(dia_omitir_e2,'{exercises}',(dia_omitir_e2->'exercises')-1); -- saca e2
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_remueve);
   RAISE EXCEPTION 'TEST_FAIL: aceptó remover un ejercicio existente';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DAY_PATCH_INVALID' THEN RAISE; END IF; END;
 dia_edita:=jsonb_set(dia_omitir_e2,'{exercises,0,series}','"3"'::jsonb); -- e1 pasa de 4 a 3 series
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_edita);
   RAISE EXCEPTION 'TEST_FAIL: aceptó editar las series de un ejercicio existente';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DAY_PATCH_INVALID' THEN RAISE; END IF; END;

 -- ---------- 2: agregar un ejercicio extra ----------
 dia_con_extra:=jsonb_set(dia_omitir_e2,'{exercises}',
   (dia_omitir_e2->'exercises') || '{"id":"ex1","nombre":"Curl con mancuernas","series":"1","reps":"12","extra":true}'::jsonb);
 series_con_extra:=series_e2_omitido || '[{"exerciseInstance":"ex1","setNumber":1,"peso":null,"reps":null,"completed":false}]';
 r:=public.v48_guardar_sesion(rev,sid,series_con_extra,'{}',dia_con_extra); rev:=(r->>'revision')::bigint;
 IF jsonb_array_length(r->'data'->'sesionActiva'->'sets') <> 7 THEN
   RAISE EXCEPTION 'TEST_FAIL: el plan debería crecer a 7 sets con el extra'; END IF;

 -- ---------- 11: un cliente viejo (4 argumentos) no puede desincronizar el día ya parchado ----------
 -- Manda sólo los 6 sets que conocía (sin el extra): series() exige longitud
 -- exacta contra el plan vigente (7) y rechaza, protegiendo el cambio nuevo
 -- en vez de perderlo silenciosamente.
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}');
   RAISE EXCEPTION 'TEST_FAIL: un cliente viejo pudo guardar un plan desactualizado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_SETS' THEN RAISE; END IF; END;
 -- Y el día/sets siguen intactos tras el intento rechazado.
 r:=public.v48_estado(sid);
 IF jsonb_array_length(r->'data'->'sesionActiva'->'sets') <> 7 THEN
   RAISE EXCEPTION 'TEST_FAIL: el intento del cliente viejo alteró el plan'; END IF;

 -- Completa la serie del extra antes de finalizar.
 series_final:=jsonb_set(series_con_extra,'{6}',
   '{"exerciseInstance":"ex1","setNumber":1,"peso":15,"reps":12,"completed":true}'::jsonb);
 r:=public.v48_guardar_sesion(rev,sid,series_final,'{}'); rev:=(r->>'revision')::bigint;

 -- ---------- 9: conflicto de revisión CAS ----------
 -- Dos "pestañas" con la MISMA revisión vieja; la primera que cambia algo
 -- real gana, la segunda (que manda un cambio real, no un no-op) debe chocar.
 -- p_final=false acá (guardado intermedio, no finalizar), así que todavía no
 -- hace falta decisión de referencia para ex1 — sólo se exige al finalizar.
 -- REVISION_CONFLICT se levanta con USING ERRCODE='40001' (condición
 -- serialization_failure), nunca con el P0001 genérico de un RAISE EXCEPTION
 -- simple. "WHEN raise_exception" acá nunca lo atrapaba — bug de esta
 -- prueba, no de v48_guardar_sesion ni de la migración.
 BEGIN
   PERFORM public.v48_guardar_sesion(rev-1,sid,series_final,'{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]}}');
   RAISE EXCEPTION 'TEST_FAIL: aceptó una revisión vieja con un cambio real';
 EXCEPTION WHEN serialization_failure THEN IF SQLERRM<>'REVISION_CONFLICT' THEN RAISE; END IF; END;
 -- Un intento rechazado por CAS no puede haber cambiado nada: ni la revisión
 -- activa, ni las series guardadas, ni dejar referencias a medio aplicar.
 r:=public.v48_estado(sid);
 IF (r->>'revision')::bigint <> rev THEN
   RAISE EXCEPTION 'TEST_FAIL: un intento rechazado por CAS no puede cambiar la revisión, dio %',(r->>'revision'); END IF;
 IF (r->'data'->'sesionActiva'->'sets') IS DISTINCT FROM series_final THEN
   RAISE EXCEPTION 'TEST_FAIL: un intento rechazado por CAS no puede cambiar las series guardadas'; END IF;
 IF coalesce(r->'data'->'sesionActiva'->'references','{}'::jsonb) <> '{}'::jsonb THEN
   RAISE EXCEPTION 'TEST_FAIL: un intento rechazado por CAS no puede dejar referencias a medio aplicar'; END IF;

 -- ---------- 10: identidad — B no puede tocar la sesión de A ----------
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 INSERT INTO public.rutinas(profile_id,data) VALUES(b,'{}'); PERFORM public.v48_activar(0);
 BEGIN
   PERFORM public.v48_guardar_sesion(0,sid,series_final,'{}',dia_con_extra);
   RAISE EXCEPTION 'TEST_FAIL: B pudo guardar sobre la sesión de A';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SESSION_NOT_ACTIVE' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);

 -- ---------- 6 y 7: finalizar — mismo entreno_id para e1 y el extra, totales correctos ----------
 -- Plan completo: e1(4)+e2(2,omitido)+ex1(1) = 7. Completados: e1 1-2, ex1 1 = 3.
 -- sets_totales esperado = 7-2(e2 omitido) = 5. sets_completados esperado = 3.
 -- v48_private.referencias exige una decisión para TODO ejercicio con alguna
 -- serie completada cuando p_final=true (v48_finalizar) — e2 omitido queda
 -- con 0 completadas y no necesita ninguna, pero ex1 (extra, 1 completada)
 -- SÍ la necesita o v48_finalizar daría REFERENCE_DECISION_REQUIRED.
 r:=public.v48_guardar_sesion(rev,sid,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
 rev:=(r->>'revision')::bigint;
 ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 r:=public.v48_finalizar(rev,sid,ms+1000,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
 -- Variable renombrada a v_entreno a propósito: un bare "entreno_id" dentro de
 -- una consulta contra public.registros sería ambiguo con la COLUMNA
 -- entreno_id de esa misma tabla (plpgsql.variable_conflict=error por
 -- defecto) y la prueba fallaría en tiempo de ejecución, no por el código
 -- bajo prueba sino por el propio test.
 v_entreno:=(r->'terminal'->>'entrenoId')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.entrenos WHERE id=v_entreno AND sets_totales=5 AND sets_completados=3) THEN
   RAISE EXCEPTION 'TEST_FAIL: totales incorrectos al finalizar, dio %',
     (SELECT row_to_json(x) FROM (SELECT sets_totales,sets_completados FROM public.entrenos WHERE id=v_entreno) x); END IF;
 SELECT count(*) INTO n_filas FROM public.registros WHERE entreno_id=v_entreno AND exercise='Curl con mancuernas';
 IF n_filas<>1 THEN RAISE EXCEPTION 'TEST_FAIL: el ejercicio extra no quedó en registros con el mismo entreno_id'; END IF;
 SELECT count(*) INTO n_filas FROM public.registros WHERE entreno_id=v_entreno AND exercise='Press de banca con barra';
 IF n_filas<>2 THEN RAISE EXCEPTION 'TEST_FAIL: e1 debería tener 2 series guardadas (1 y 2), dio %',n_filas; END IF;
 IF EXISTS(SELECT 1 FROM public.registros WHERE entreno_id=v_entreno AND exercise='Remo con barra') THEN
   RAISE EXCEPTION 'TEST_FAIL: e2 estaba omitido y no debería tener ninguna fila en registros'; END IF;

 -- ---------- 8a: idempotencia de un cierre reciente ----------
 -- La rama de reintento de v48_finalizar hashea p_referencias TAL COMO
 -- LLEGA (no la vuelve a pasar por v48_private.referencias), así que para
 -- que el hash coincida con el del cierre original hace falta mandar
 -- EXACTAMENTE el mismo payload — las dos decisiones (e1 y ex1), no sólo
 -- una. Mandar menos claves que el cierre real es un payload distinto, y
 -- IDEMPOTENCY_CONFLICT en ese caso es correcto, no un bug de v48_finalizar.
 PERFORM public.v48_finalizar(rev,sid,ms+1000,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
 IF (SELECT count(*) FROM public.sesiones_v48_control WHERE sesion_id=sid)<>1 THEN
   RAISE EXCEPTION 'TEST_FAIL: el reintento del cierre duplicó el control terminal'; END IF;

 -- ---------- 8b: compatibilidad con un cierre TERMINAL ANTERIOR a esta migración ----------
 -- El fixture (hash, entreno y fila de control) ya se creó como postgres, en
 -- el DO anterior (antes de SET LOCAL ROLE authenticated) — v48_private no
 -- tiene USAGE/EXECUTE para authenticated y sesiones_v48_control sólo le da
 -- SELECT. Acá sólo se reproduce la llamada que haría un cliente real
 -- reintentando ese cierre viejo.
 r:=public.v48_finalizar(rev,current_setting('v48.test_sesion_viejo')::uuid,
   current_setting('v48.test_ms_viejo')::bigint+5000,
   '[{"exerciseInstance":"solo","setNumber":1,"peso":20,"reps":10,"completed":true}]'::jsonb,'{}');
 IF (r->'terminal'->>'entrenoId')::uuid IS DISTINCT FROM current_setting('v48.test_entreno_viejo')::uuid THEN
   RAISE EXCEPTION 'TEST_FAIL: el reintento de un cierre pre-migración no devolvió el entreno original'; END IF;

 -- ---------- grants ----------
 IF has_function_privilege('anon','public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'EXECUTE anon en la firma de 5 argumentos'; END IF;
 IF NOT has_function_privilege('authenticated','public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'Falta EXECUTE autenticado en la firma de 5 argumentos'; END IF;

 RAISE NOTICE 'V51.3 omitidos/extras smoke: OK; se revierte todo';
END $$;
RESET ROLE;
ROLLBACK;
