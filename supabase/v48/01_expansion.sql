-- V48 / 01: expansión compatible. Ejecutar SOLO tras aprobación, como postgres.
-- NO ejecutado por Codex. Una sola vez; falla ante instalación previa/drift.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta extensions.digest(text,text)';
  END IF;
END $$;

CREATE SCHEMA v48_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA v48_private FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.rutinas
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD COLUMN cliente_v48 boolean NOT NULL DEFAULT false;

ALTER TABLE public.entrenos
  ADD COLUMN sesion_id uuid,
  ADD COLUMN inicio_ms bigint,
  ADD COLUMN fin_ms bigint,
  ADD COLUMN zona_horaria text,
  ADD CONSTRAINT entrenos_sesion_v48_unique UNIQUE (profile_id, sesion_id),
  ADD CONSTRAINT entrenos_id_profile_v48_unique UNIQUE (id, profile_id),
  ADD CONSTRAINT entrenos_tiempos_v48_check CHECK (
    (sesion_id IS NULL AND inicio_ms IS NULL AND fin_ms IS NULL AND zona_horaria IS NULL)
    OR (sesion_id IS NOT NULL AND inicio_ms IS NOT NULL AND fin_ms IS NOT NULL
      AND inicio_ms > 0 AND fin_ms >= inicio_ms
      AND zona_horaria IS NOT NULL AND btrim(zona_horaria) <> ''
      AND date IS NOT NULL AND date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND sets_totales IS NOT NULL AND sets_completados IS NOT NULL
      AND sets_totales >= 0 AND sets_completados >= 0 AND sets_completados <= sets_totales
      AND NOT is_manual AND routine_origin IS NOT NULL)
  );

ALTER TABLE public.registros
  ADD COLUMN entreno_id uuid,
  ADD COLUMN ejercicio_instancia text,
  ADD CONSTRAINT registros_entreno_owner_v48_fk
    FOREIGN KEY (entreno_id, profile_id)
    REFERENCES public.entrenos(id, profile_id) ON DELETE CASCADE,
  ADD CONSTRAINT registros_serie_v48_unique UNIQUE (entreno_id, ejercicio_instancia, set_number),
  ADD CONSTRAINT registros_realizados_v48_check CHECK (
    (entreno_id IS NULL AND ejercicio_instancia IS NULL)
    OR (entreno_id IS NOT NULL AND ejercicio_instancia IS NOT NULL
      AND btrim(ejercicio_instancia) <> '' AND set_number IS NOT NULL AND set_number > 0
      AND btrim(exercise) <> '' AND peso IS NOT NULL AND peso >= 0
      AND peso::text NOT IN ('NaN','Infinity','-Infinity')
      AND series IS NOT NULL AND series = '1' AND reps IS NOT NULL
      AND CASE WHEN reps ~ '^[1-9][0-9]{0,9}$'
        THEN reps::bigint <= 2147483647 ELSE false END)
  );

-- Sin FK a entrenos: el comprobante debe sobrevivir a su borrado físico.
CREATE TABLE public.sesiones_v48_control (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sesion_id uuid NOT NULL,
  entreno_id uuid,
  estado text NOT NULL CHECK (estado IN ('finalizada','eliminada','cancelada')),
  contenido_sha256 bytea,
  creada_ms bigint NOT NULL CHECK (creada_ms > 0),
  eliminada_ms bigint,
  PRIMARY KEY (profile_id, sesion_id),
  CHECK (contenido_sha256 IS NULL OR octet_length(contenido_sha256) = 32),
  CHECK (
    (estado = 'finalizada' AND entreno_id IS NOT NULL AND contenido_sha256 IS NOT NULL AND eliminada_ms IS NULL)
    OR (estado = 'eliminada' AND entreno_id IS NOT NULL AND contenido_sha256 IS NOT NULL AND eliminada_ms IS NOT NULL)
    OR (estado = 'cancelada' AND entreno_id IS NULL AND contenido_sha256 IS NULL AND eliminada_ms IS NULL)
  ),
  CHECK (eliminada_ms IS NULL OR eliminada_ms >= creada_ms)
);
-- Neutralizar defaults amplios en la MISMA transacción de creación.
REVOKE ALL ON TABLE public.sesiones_v48_control FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.sesiones_v48_control ENABLE ROW LEVEL SECURITY;
CREATE POLICY sesiones_v48_lectura ON public.sesiones_v48_control
  FOR SELECT TO authenticated USING (profile_id = auth.uid());
GRANT SELECT ON public.sesiones_v48_control TO authenticated;

-- INVOKER intencional: current_user debe conservar el rol que hace el DML.
-- RPCs son DEFINER postgres; llamadas REST directas son authenticated/anon.
CREATE FUNCTION v48_private.guardar_rutina_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user <> 'postgres' AND (NEW.cliente_v48 OR NEW.revision <> 0) THEN
      RAISE EXCEPTION 'V48_RPC_REQUIRED' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF current_user <> 'postgres' AND OLD.cliente_v48 THEN
    RAISE EXCEPTION 'V48_CLIENT_UPDATE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF current_user <> 'postgres' AND
     (NEW.cliente_v48 IS DISTINCT FROM OLD.cliente_v48 OR NEW.profile_id <> OLD.profile_id) THEN
    RAISE EXCEPTION 'V48_RPC_REQUIRED' USING ERRCODE='42501';
  END IF;
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;
CREATE TRIGGER rutinas_v48_guard BEFORE INSERT OR UPDATE OR DELETE ON public.rutinas
  FOR EACH ROW EXECUTE FUNCTION v48_private.guardar_rutina_guard();

CREATE FUNCTION v48_private.historial_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE pid uuid; protegido boolean;
BEGIN
  IF current_user = 'postgres' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN pid := OLD.profile_id; ELSE pid := NEW.profile_id; END IF;
  IF TG_OP = 'UPDATE' AND NEW.profile_id <> OLD.profile_id THEN
    RAISE EXCEPTION 'V48_OWNER_IMMUTABLE' USING ERRCODE='42501';
  END IF;
  -- Serializar DML legado con activación por cuenta. La RLS existente sigue activa.
  SELECT cliente_v48 INTO protegido FROM public.rutinas WHERE profile_id = pid FOR UPDATE;
  IF protegido THEN RAISE EXCEPTION 'V48_CLIENT_UPDATE_REQUIRED' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME = 'entrenos' THEN
    IF (TG_OP <> 'DELETE' AND NEW.sesion_id IS NOT NULL)
      OR (TG_OP <> 'INSERT' AND OLD.sesion_id IS NOT NULL) THEN
      RAISE EXCEPTION 'V48_RPC_REQUIRED' USING ERRCODE='42501';
    END IF;
  ELSE
    IF (TG_OP <> 'DELETE' AND NEW.entreno_id IS NOT NULL)
      OR (TG_OP <> 'INSERT' AND OLD.entreno_id IS NOT NULL) THEN
      RAISE EXCEPTION 'V48_RPC_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER registros_v48_guard BEFORE INSERT OR UPDATE OR DELETE ON public.registros
  FOR EACH ROW EXECUTE FUNCTION v48_private.historial_guard();
CREATE TRIGGER entrenos_v48_guard BEFORE INSERT OR UPDATE OR DELETE ON public.entrenos
  FOR EACH ROW EXECUTE FUNCTION v48_private.historial_guard();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA v48_private FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
