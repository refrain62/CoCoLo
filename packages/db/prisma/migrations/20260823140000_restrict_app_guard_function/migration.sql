-- app_guardはinvokerとして実行し、search_pathと実行権限を固定してRLS境界を迂回できないようにする。
ALTER FUNCTION public.app_guard_promotion_run_transition() SECURITY INVOKER;
ALTER FUNCTION public.app_guard_promotion_run_transition() SET search_path = pg_catalog, public;
REVOKE ALL ON FUNCTION public.app_guard_promotion_run_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_guard_promotion_run_transition() TO cocolo_app;
