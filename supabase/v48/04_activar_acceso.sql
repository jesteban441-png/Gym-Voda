-- V48 / 04: habilitar RPC tras pruebas y cliente compatible. NO activa cuentas.
-- V47 conserva DML solo para cuentas cliente_v48=false; triggers rechazan el resto.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ DECLARE f record; BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF;
  IF to_regprocedure('public.v48_historico_eliminar(uuid)') IS NULL THEN RAISE EXCEPTION 'Falta fase 03'; END IF;
  FOR f IN SELECT p.oid::regprocedure AS firma FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'v48\_%' ESCAPE '\' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',f.firma);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.firma);
  END LOOP;
END $$;

-- No son necesarios para ningún flujo publicado. NO retirar aquí DML global.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE
  public.rutinas, public.registros, public.entrenos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sesiones_v48_control FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sesiones_v48_control TO authenticated;

DO $$ DECLARE f record; t text; rol text; priv text; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'v48\_%' ESCAPE '\' LOOP
    IF has_function_privilege('anon',f.oid,'EXECUTE') THEN RAISE EXCEPTION 'EXECUTE anon heredado'; END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['rutinas','registros','entrenos'] LOOP
    FOREACH rol IN ARRAY ARRAY['anon','authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
        IF has_table_privilege(rol,'public.'||t,priv) THEN RAISE EXCEPTION 'Privilegio residual %.% %',rol,t,priv; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
