-- Apply ONLY after the admin-orders endpoint and updated bg-admin.html are live.
-- CRM uses the separate orders table; its status-back-sync is SECURITY DEFINER.
begin;
drop policy if exists bg_orders_anon_all on public.bg_orders;
drop policy if exists bg_wfp_events_anon_all on public.bg_wayforpay_events;
commit;
