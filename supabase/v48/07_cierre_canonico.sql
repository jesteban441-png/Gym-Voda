-- V48 C-B: corrección local NO ejecutada. Orden: 01,02,03,07,04,05.
-- Conserva firmas y transacción; no reescribe filas históricas.
-- Catálogo derivado de EXERCISES/EXERCISE_ALIASES en index.html; comprobar paridad antes de activar.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
 IF to_regprocedure('public.v48_finalizar(bigint,uuid,bigint,jsonb,jsonb)') IS NULL THEN RAISE EXCEPTION 'Falta fase 02'; END IF;
END $$;
CREATE FUNCTION v48_private.nombre_canonico(p_nombre text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $canonical$
DECLARE
 aliases jsonb := $aliases${"Sentadilla":"Sentadilla con barra","Prensa de piernas":"Prensa inclinada","Extensión de cuádriceps":"Extensión de piernas","Zancadas con mancuernas":"Estocadas con mancuerna","Peso muerto":"Peso muerto con barra","Peso muerto con mancuerna":"Peso muerto con mancuernas","Peso muerto sumo":"Peso muerto sumo con barra","Peso muerto rumano":"Peso muerto rumano con barra","Curl femoral sentado":"Isquio sentado","Curl femoral acostado":"Isquio acostado","Elevación de talones en prensa":"Gemelos en prensa","Elevación de talones de pie":"Gemelos en máquina","Elevación de talones sentado":"Gemelos sentado en máquina","Sentadilla hack":"Sentadilla Hack","Step up":"Step Up","Sentadilla sumo":"Sentadilla Sumo","Puente de glúteo":"Puente de glúteos","Extensión de cadera en máquina":"Patada de glúteo en máquina","Elevación de talones de pie con disco":"Gemelos parado con mancuerna","Pullover con mancuerna":"Pullover","Remo con mancuerna":"Remo con mancuerna unilateral","Press Arnold":"Arnold press","Press tras nuca":"Press tras nuca con barra","Elevaciones laterales":"Vuelos laterales con mancuerna","Elevaciones frontales":"Vuelos frontales","Pájaro (deltoide posterior)":"Vuelos pájaro","Face pull":"Face Pull","Press militar con mancuernas":"Press de hombros con mancuernas","Gemelos":"Gemelos parado con mancuerna","Press banca plano":"Press de banca con barra","Press banca inclinado":"Press de banca inclinado con barra","Pec deck (contractora)":"Pec Fly","Pec deck inverso":"Pec Fly invertido","Extensión de tríceps en polea c/barra":"Extensión de tríceps en polea con barra","Extensión de tríceps en polea ag/Neutro":"Extensión de tríceps en polea","Extensión de tríceps en polea ag/Prono":"Extensión de tríceps en polea con barra","Curl con mancuernas inclinado":"Curl con mancuernas banco inclinado","Press militar maquina":"Press de hombros en máquina"}$aliases$::jsonb;
 indice jsonb := $indice${"press banca barra":"Press de banca con barra","flexiones brazo":"Flexiones de brazo","press banca inclinado barra":"Press de banca inclinado con barra","press banca inclinado mancuernas":"Press de banca inclinado con mancuernas","pec fly":"Pec Fly","aperturas pecho mancuernas banco plano":"Aperturas de pecho con mancuernas en banco plano","aperturas pecho mancuernas banco inclinado":"Aperturas de pecho con mancuernas en banco inclinado","press pecho polea":"Press de pecho en polea","fondos inclinado":"Fondos inclinado","press banca declinado":"Press de banca declinado","press banca plano smith":"Press de banca plano en Smith","press banca inclinado smith":"Press de banca inclinado en Smith","press banca declinado smith":"Press de banca declinado en Smith","dominadas":"Dominadas","dominadas supinas":"Dominadas supinas","jalon pecho":"Jalón al pecho","remo barra":"Remo con barra","remo mancuerna unilateral":"Remo con mancuerna unilateral","remo polea baja":"Remo en polea baja","remo maquina":"Remo en máquina","remo maquina agarre ancho":"Remo en máquina agarre ancho","remo maquina unilateral":"Remo en máquina unilateral","remo t":"Remo en T","remo trx":"Remo en TRX","remo hammer":"Remo en Hammer","jalon agarre supino":"Jalón agarre supino","jalon agarre neutro":"Jalón agarre neutro","peso muerto barra":"Peso muerto con barra","peso muerto rumano barra":"Peso muerto rumano con barra","peso muerto sumo barra":"Peso muerto sumo con barra","peso muerto mancuernas":"Peso muerto con mancuernas","hiperextensiones":"Hiperextensiones","face pull":"Face Pull","pullover":"Pullover","sentadilla barra":"Sentadilla con barra","sentadilla frontal":"Sentadilla frontal","sentadilla bulgara":"Sentadilla búlgara","sentadilla sumo":"Sentadilla Sumo","sentadilla hack":"Sentadilla Hack","sentadilla smith":"Sentadilla Smith","prensa inclinada":"Prensa inclinada","extension piernas":"Extensión de piernas","isquio acostado":"Isquio acostado","isquio sentado":"Isquio sentado","estocadas mancuerna":"Estocadas con mancuerna","hip thrust barra":"Hip thrust con barra","hip thrust maquina":"Hip thrust en máquina","puente gluteos":"Puente de glúteos","peso muerto rumano mancuernas":"Peso muerto rumano con mancuernas","peso muerto sumo mancuernas":"Peso muerto sumo con mancuernas","gemelos maquina":"Gemelos en máquina","gemelos parado mancuerna":"Gemelos parado con mancuerna","gemelos sentado maquina":"Gemelos sentado en máquina","gemelos prensa":"Gemelos en prensa","abductores maquina":"Abductores en máquina","aductores maquina":"Aductores en máquina","step up":"Step Up","press militar barra":"Press militar con barra","press hombros mancuernas":"Press de hombros con mancuernas","press militar mancuernas sentado":"Press militar con mancuernas sentado","press hombros maquina":"Press de hombros en máquina","arnold press":"Arnold press","press tras nuca barra":"Press tras nuca con barra","vuelos laterales mancuerna":"Vuelos laterales con mancuerna","elevacion lateral maquina":"Elevación lateral en máquina","elevacion lateral polea":"Elevación lateral en polea","vuelos frontales":"Vuelos frontales","vuelos pajaro":"Vuelos pájaro","pec fly invertido":"Pec Fly invertido","remo menton":"Remo al mentón","encogimientos mancuernas":"Encogimientos con mancuernas","encogimientos barra":"Encogimientos con barra","encogimientos maquina":"Encogimientos en máquina","curl barra":"Curl con barra","curl mancuernas":"Curl con mancuernas","curl mancuernas alternado":"Curl con mancuernas alternado","curl mancuernas banco inclinado":"Curl con mancuernas banco inclinado","curl martillo":"Curl martillo","curl concentrado":"Curl concentrado","curl polea":"Curl en polea","curl polea unilateral":"Curl en polea unilateral","curl scott predicador":"Curl Scott (predicador)","press frances":"Press francés","extension triceps polea":"Extensión de tríceps en polea","extension triceps polea barra":"Extensión de tríceps en polea con barra","fondos triceps banco":"Fondos de tríceps en banco","patada triceps":"Patada de tríceps","extension triceps mancuerna":"Extensión de tríceps con mancuerna","press cerrado":"Press cerrado","curl muneca":"Curl de muñeca","curl muneca inverso":"Curl de muñeca inverso","abdominales crunch":"Abdominales crunch","elevacion piernas colgado":"Elevación de piernas colgado","plancha":"Plancha","plancha lateral":"Plancha lateral","rueda abdominal":"Rueda abdominal","crunch polea":"Crunch en polea","giro ruso russian twist":"Giro ruso (russian twist)","mountain climbers":"Mountain climbers","cinta caminar correr":"Cinta (caminar/correr)","bicicleta fija":"Bicicleta fija","eliptico":"Elíptico","maquina remo":"Máquina de remo","escaladora":"Escaladora","salto soga":"Salto de soga","burpees":"Burpees","kettlebell swing":"Kettlebell swing","battle rope":"Battle rope","trineo sled":"Trineo (sled)","patada gluteo polea":"Patada de glúteo en polea","patada gluteo maquina":"Patada de glúteo en máquina","sentadilla":"Sentadilla con barra","prensa piernas":"Prensa inclinada","extension cuadriceps":"Extensión de piernas","zancadas mancuernas":"Estocadas con mancuerna","peso muerto":"Peso muerto con barra","peso muerto mancuerna":"Peso muerto con mancuernas","peso muerto sumo":"Peso muerto sumo con barra","peso muerto rumano":"Peso muerto rumano con barra","curl femoral sentado":"Isquio sentado","curl femoral acostado":"Isquio acostado","elevacion talones prensa":"Gemelos en prensa","elevacion talones pie":"Gemelos en máquina","elevacion talones sentado":"Gemelos sentado en máquina","puente gluteo":"Puente de glúteos","extension cadera maquina":"Patada de glúteo en máquina","elevacion talones pie disco":"Gemelos parado con mancuerna","pullover mancuerna":"Pullover","remo mancuerna":"Remo con mancuerna unilateral","press arnold":"Arnold press","press tras nuca":"Press tras nuca con barra","elevaciones laterales":"Vuelos laterales con mancuerna","elevaciones frontales":"Vuelos frontales","pajaro deltoide posterior":"Vuelos pájaro","press militar mancuernas":"Press de hombros con mancuernas","gemelos":"Gemelos parado con mancuerna","press banca plano":"Press de banca con barra","press banca inclinado":"Press de banca inclinado con barra","pec deck contractora":"Pec Fly","pec deck inverso":"Pec Fly invertido","extension triceps polea c barra":"Extensión de tríceps en polea con barra","extension triceps polea ag neutro":"Extensión de tríceps en polea","extension triceps polea ag prono":"Extensión de tríceps en polea con barra","curl mancuernas inclinado":"Curl con mancuernas banco inclinado","press militar maquina":"Press de hombros en máquina"}$indice$::jsonb;
 clave text; destino text;
BEGIN
 IF p_nombre IS NULL OR p_nombre='' THEN RETURN p_nombre; END IF;
 destino:=aliases->>p_nombre;
 IF destino IS NOT NULL THEN RETURN destino; END IF;
 clave:=btrim(regexp_replace(regexp_replace(normalize(lower(p_nombre),NFD),'[̀-ͯ]','','g'),'[^a-z0-9]+',' ','g'));
 SELECT string_agg(word,' ' ORDER BY ordinal) INTO clave FROM unnest(string_to_array(clave,' ')) WITH ORDINALITY x(word,ordinal)
 WHERE word<>'' AND word<>ALL(ARRAY['de','del','la','el','los','las','con','en','a','al','y','para','por','un','una']);
 RETURN coalesce(indice->>clave,p_nombre);
END $canonical$;
REVOKE ALL ON FUNCTION v48_private.nombre_canonico(text) FROM PUBLIC,anon,authenticated,service_role;
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
-- La fase 04 habilita authenticated después de esta corrección y sus pruebas.
REVOKE ALL ON FUNCTION public.v48_finalizar(bigint,uuid,bigint,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
