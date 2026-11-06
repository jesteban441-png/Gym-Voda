-- SOLO STAGING. Variante de 13_pruebas_omitidos_extras.sql que usa UN SOLO
-- perfil real (vacío) y sintetiza el segundo DENTRO de la misma transacción
-- que termina en ROLLBACK. PREPARADO, NO EJECUTADO.
--
-- Por qué existe esta variante: 13_pruebas_omitidos_extras.sql exige DOS
-- perfiles reales previamente vacíos. En este staging sólo uno lo está
-- (e9fe98b8-1ece-4287-83b5-a2234be27a5e); el otro tiene datos reales y no se
-- puede usar. En vez de crear una segunda cuenta Auth real, el segundo actor
-- ("b") se sintetiza con un INSERT directo en auth.users + public.profiles,
-- usando un UUID generado en el momento — nunca persiste, porque TODA la
-- transacción (incluida esa fila sintética) se revierte al final igual que
-- en el archivo original.
--
-- Por qué es seguro insertar directo en auth.users en ESTE caso puntual:
--   - public.profiles sólo exige id (sin default) y name (sin default) —
--     confirmado en staging/v48/baseline_v47.sql. Ningún trigger en
--     public.profiles.
--   - auth.users sólo exige id sin default (confirmado por el usuario vía
--     information_schema.columns en este mismo proyecto de staging); el
--     resto admite NULL o tiene DEFAULT.
--   - El preflight de abajo repite, EN EL MOMENTO, la misma comprobación que
--     ya hizo baseline_v47.sql al instalar: cero triggers no internos en
--     auth.users. Si algo cambió desde entonces, esto se detiene solo, antes
--     de insertar nada.
--   - profiles.id → auth.users.id tiene ON DELETE CASCADE: aunque algo
--     fallara a mitad de camino, un ROLLBACK (o el CASCADE si alguna vez se
--     confirmara, que acá nunca pasa) no deja basura cruzada.
--
-- Ninguna aserción de identidad/CAS/idempotencia se debilitó: "b" sigue
-- siendo un perfil genuino y distinto de "a" en todo lo que la transacción
-- dura, con su propia fila en auth.users/profiles satisfaciendo las mismas
-- FK que un usuario real.
--
-- Requiere 01,02,03,07,09,04,12 y el perfil REAL vacío en v48.test_a.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- V51.3: antes esto era un comentario (dos líneas con "--") que había que
-- descomentar/pegar a mano antes del primer DO. Ejecutarlo como comentario
-- deja v48.test_a sin configurar y el preflight se detiene con "Configurar
-- v48.test_a con el perfil real vacío" — exactamente el error reportado. Se
-- convierte en una instrucción real, con el UUID ya confirmado para ESTE
-- proyecto de staging, para que una sola ejecución del archivo baste.
SELECT set_config('v48.test_a','e9fe98b8-1ece-4287-83b5-a2234be27a5e',true);
DO $$
DECLARE a uuid:=nullif(current_setting('v48.test_a',true),'')::uuid;
 b uuid:=gen_random_uuid();
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
 IF a IS NULL THEN RAISE EXCEPTION 'Configurar v48.test_a con el perfil real vacío'; END IF;
 IF (SELECT count(*) FROM public.profiles WHERE id=a)<>1 THEN RAISE EXCEPTION 'Falta el profile real de a'; END IF;
 IF EXISTS(SELECT 1 FROM public.rutinas WHERE profile_id=a)
  OR EXISTS(SELECT 1 FROM public.registros WHERE profile_id=a)
  OR EXISTS(SELECT 1 FROM public.entrenos WHERE profile_id=a) THEN
  RAISE EXCEPTION 'El perfil real de a ya no está vacío — NO continuar, es el que no hay que tocar'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=b) OR EXISTS(SELECT 1 FROM public.profiles WHERE id=b) THEN
  RAISE EXCEPTION 'Colisión de UUID sintético — reintentar'; END IF;
 IF to_regprocedure('public.v48_guardar_sesion(bigint,uuid,jsonb,jsonb,jsonb)') IS NULL THEN RAISE EXCEPTION 'Falta fase 12'; END IF;
 -- Repite, EN EL MOMENTO, la misma comprobación que hizo baseline_v47.sql al
 -- instalar. No asumir que sigue siendo cierto sólo porque lo fue entonces.
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'Staging tiene triggers no internos en auth.users: no sintetizar usuarios acá'; END IF;
 -- Fila sintética, mínima, sólo para que profiles.id encuentre su FK. Vive
 -- sólo dentro de esta transacción.
 INSERT INTO auth.users(id) VALUES(b);
 INSERT INTO public.profiles(id,name) VALUES(b,'Sintético V51.3 — transacción con ROLLBACK, nunca persiste');
 PERFORM set_config('v48.test_b_sintetico',b::text,true);
 -- V51.3: el fixture "cierre anterior a la migración" (prueba 8b, más abajo)
 -- se arma ACÁ, como postgres, por DOS razones — no sólo por hash_cierre:
 --   1) v48_private no tiene USAGE/EXECUTE para authenticated (a propósito:
 --      nadie fuera del servidor tiene que poder calcular ese hash).
 --   2) sesiones_v48_control sólo le da SELECT a authenticated (ver
 --      04_activar_acceso.sql) — un INSERT directo ahí bajo authenticated
 --      fallaría con el mismo "permission denied", aunque el hash se
 --      resolviera. Las dos filas sintéticas (entrenos + control) se crean
 --      acá; al bloque de abajo sólo se llevan los valores que un cliente
 --      real le mandaría a v48_finalizar() (sesión, fin, series) — nunca el
 --      hash ni ningún acceso directo a v48_private.
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
DECLARE a uuid:=current_setting('v48.test_a')::uuid; b uuid:=current_setting('v48.test_b_sintetico')::uuid;
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
 r:=public.v48_estado(sid);
 IF (r->'data'->'sesionActiva'->'sets') IS DISTINCT FROM series_e1_parcial THEN
   RAISE EXCEPTION 'TEST_FAIL: el intento rechazado modificó las series guardadas'; END IF;

 -- ---------- 5: dejar series pendientes y continuar NO es omitir ----------
 r:=public.v48_guardar_sesion(rev,sid,series_e1_parcial,'{}'); rev:=(r->>'revision')::bigint;
 IF coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->0->>'omitido')::boolean,false) THEN
   RAISE EXCEPTION 'TEST_FAIL: dejar series pendientes no puede marcar omitido solo'; END IF;

 -- ---------- 2 y 3: omitir e2 (sin progreso) vía la firma de 5 ----------
 dia_omitir_e2:=jsonb_set(dia0,'{exercises,1,omitido}','true'::jsonb);
 series_e2_omitido:=series_e1_parcial;
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_omitir_e2); rev:=(r->>'revision')::bigint;
 IF NOT coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->1->>'omitido')::boolean,false) THEN
   RAISE EXCEPTION 'TEST_FAIL: e2 debería quedar omitido'; END IF;

 dia_restaurar_e2:=jsonb_set(dia_omitir_e2,'{exercises,1,omitido}','false'::jsonb);
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_restaurar_e2); rev:=(r->>'revision')::bigint;
 IF coalesce((r->'data'->'sesionActiva'->'day'->'exercises'->1->>'omitido')::boolean,true) THEN
   RAISE EXCEPTION 'TEST_FAIL: restaurar e2 no funcionó'; END IF;
 r:=public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_omitir_e2); rev:=(r->>'revision')::bigint;

 -- ---------- 3: el patch de día rechaza remover o editar lo existente ----------
 dia_remueve:=jsonb_set(dia_omitir_e2,'{exercises}',(dia_omitir_e2->'exercises')-1);
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}',dia_remueve);
   RAISE EXCEPTION 'TEST_FAIL: aceptó remover un ejercicio existente';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'DAY_PATCH_INVALID' THEN RAISE; END IF; END;
 dia_edita:=jsonb_set(dia_omitir_e2,'{exercises,0,series}','"3"'::jsonb);
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
 BEGIN
   PERFORM public.v48_guardar_sesion(rev,sid,series_e2_omitido,'{}');
   RAISE EXCEPTION 'TEST_FAIL: un cliente viejo pudo guardar un plan desactualizado';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'INVALID_SETS' THEN RAISE; END IF; END;
 r:=public.v48_estado(sid);
 IF jsonb_array_length(r->'data'->'sesionActiva'->'sets') <> 7 THEN
   RAISE EXCEPTION 'TEST_FAIL: el intento del cliente viejo alteró el plan'; END IF;

 series_final:=jsonb_set(series_con_extra,'{6}',
   '{"exerciseInstance":"ex1","setNumber":1,"peso":15,"reps":12,"completed":true}'::jsonb);
 r:=public.v48_guardar_sesion(rev,sid,series_final,'{}'); rev:=(r->>'revision')::bigint;

 -- ---------- 9: conflicto de revisión CAS ----------
 -- REVISION_CONFLICT se levanta con USING ERRCODE='40001' (condición
 -- serialization_failure), nunca con el P0001 genérico de un RAISE EXCEPTION
 -- simple (ese sería "raise_exception"). Es deliberado: así un cliente real
 -- puede distinguir "conflicto de concurrencia, reintentable" de cualquier
 -- otro rechazo. "WHEN raise_exception" acá nunca iba a atraparlo — ese era
 -- el bug real, de esta prueba, no de v48_guardar_sesion ni de la migración.
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

 -- ---------- 10: identidad — b (sintético) no puede tocar la sesión de a ----------
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 INSERT INTO public.rutinas(profile_id,data) VALUES(b,'{}'); PERFORM public.v48_activar(0);
 BEGIN
   PERFORM public.v48_guardar_sesion(0,sid,series_final,'{}',dia_con_extra);
   RAISE EXCEPTION 'TEST_FAIL: b pudo guardar sobre la sesión de a';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'SESSION_NOT_ACTIVE' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub',a::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);

 -- ---------- 6 y 7: finalizar — mismo entreno_id para e1 y el extra, totales correctos ----------
 r:=public.v48_guardar_sesion(rev,sid,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
 rev:=(r->>'revision')::bigint;
 ms:=(extract(epoch FROM clock_timestamp())*1000)::bigint;
 r:=public.v48_finalizar(rev,sid,ms+1000,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
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
 -- La rama de reintento de v48_finalizar hashea p_referencias TAL COMO LLEGA
 -- (no la vuelve a pasar por v48_private.referencias), así que para que el
 -- hash coincida con el del cierre original hace falta mandar EXACTAMENTE
 -- el mismo payload — las dos decisiones (e1 y ex1), no sólo una. Mandar
 -- menos claves que el cierre real no es "el mismo reintento": es un
 -- payload distinto, y IDEMPOTENCY_CONFLICT en ese caso es correcto, no un
 -- bug de v48_finalizar.
 PERFORM public.v48_finalizar(rev,sid,ms+1000,series_final,
   '{"e1":{"accepted":false,"sets":[{"setNumber":1,"peso":40,"reps":10},{"setNumber":2,"peso":42,"reps":8}]},
     "ex1":{"accepted":false,"sets":[{"setNumber":1,"peso":15,"reps":12}]}}');
 IF (SELECT count(*) FROM public.sesiones_v48_control WHERE sesion_id=sid)<>1 THEN
   RAISE EXCEPTION 'TEST_FAIL: el reintento del cierre duplicó el control terminal'; END IF;

 -- ---------- 8b: compatibilidad con un cierre TERMINAL ANTERIOR a esta migración ----------
 -- El fixture (hash, entreno y fila de control) ya se creó como postgres, en
 -- el DO anterior (antes de SET LOCAL ROLE authenticated) — ver el comentario
 -- de ahí. Acá sólo se reproduce la llamada que haría un cliente real
 -- reintentando ese cierre viejo: ningún acceso a v48_private, ningún INSERT
 -- directo a sesiones_v48_control bajo authenticated.
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

 RAISE NOTICE 'V51.3 omitidos/extras (perfil sintético) smoke: OK; se revierte todo, incluido auth.users sintético';
END $$;
RESET ROLE;
ROLLBACK;
