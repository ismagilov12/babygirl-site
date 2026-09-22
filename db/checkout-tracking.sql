-- Apply before deploying the checkout changes. Existing orders/policies remain unchanged.
begin;
create table public.bg_order_tracking (
  order_ref text primary key,
  order_data jsonb not null,
  fbp text,
  fbc text,
  client_ip text,
  client_ua text,
  paid_at timestamptz,
  capi_sent_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.bg_order_tracking enable row level security;
revoke all on public.bg_order_tracking from public, anon, authenticated;
grant select, insert, update on public.bg_order_tracking to service_role;
commit;
