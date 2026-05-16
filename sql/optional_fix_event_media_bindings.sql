-- Ejecutar SOLO si confirmaste que los bindings viejos pertenecen al evento actual.
-- Cambiar OLD_EVENT_ID / NEW_EVENT_ID si aplica.

update public.media_bindings
set scope_id = '58d8a7d4-b4a4-4fa9-9c6f-4604826adb5d'
where scope = 'event'
  and scope_id = '0b67e67b-b0d6-47f1-838b-59f02fb928c4';

select
  b.scope,
  b.scope_id,
  e.title,
  b.slot,
  a.name,
  a.public_url
from public.media_bindings b
left join public.events e on e.id = b.scope_id
left join public.media_assets a on a.id = b.media_id
where b.scope = 'event'
order by b.updated_at desc;
