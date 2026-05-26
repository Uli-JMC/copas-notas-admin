-- ECN optional RLS hardening
-- Ejecutar SOLO si querés que la escritura de medios, bindings y menú sea exclusiva para admins.
-- Antes de correrlo, confirmá que public.is_admin() existe y que tu usuario está en public.admins.

-- Media assets: lectura pública, escritura solo admin
alter table public.media_assets enable row level security;

drop policy if exists media_assets_write_authenticated on public.media_assets;
drop policy if exists media_assets_admin_all on public.media_assets;
create policy media_assets_admin_all
on public.media_assets
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Media bindings: lectura pública, escritura solo admin
alter table public.media_bindings enable row level security;

drop policy if exists media_bindings_write_authenticated on public.media_bindings;
drop policy if exists media_bindings_admin_all on public.media_bindings;
create policy media_bindings_admin_all
on public.media_bindings
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Menu items: lectura pública, escritura solo admin
alter table public.menu_items enable row level security;

drop policy if exists menu_items_write_authenticated on public.menu_items;
drop policy if exists menu_items_admin_all on public.menu_items;
create policy menu_items_admin_all
on public.menu_items
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
