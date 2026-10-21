-- CONTENCIÓN MANUAL, no ejecutar preventivamente ni como parte de instalación.
-- Detiene nuevas activaciones/inicios. Mantiene recuperación de sesiones en curso.
BEGIN;
DO $$ BEGIN IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Ejecutar como postgres'; END IF; END $$;
REVOKE ALL ON FUNCTION public.v48_activar(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.v48_iniciar(bigint,uuid,text,text,bigint,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
-- No desactivar banderas, borrar comprobantes ni restaurar cliente V47.
-- Reabrir solo estas dos firmas tras revisión; no repetir todo 04 indiscriminadamente.
