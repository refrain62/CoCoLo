-- central feature schemaの関数再作成後にapp_guardの実行境界を再固定する。
ALTER FUNCTION public.app_guard_promotion_run_transition() SECURITY INVOKER;
ALTER FUNCTION public.app_guard_promotion_run_transition() SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.app_guard_promotion_run_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_guard_promotion_run_transition() TO cocolo_app;
