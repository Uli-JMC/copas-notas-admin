ECN Admin replacements v2026-02-26

Reemplazar en el proyecto:
- admin.html
- js/admin.js
- js/admin-gallery.js
- js/admin-promos.js

Estos archivos están alineados a la BD real validada:
- events requiere title/type/month_key NOT NULL.
- events.duration_hours es text.
- gallery_items.type acepta solo cocteles/maridajes.
- promos.kind acepta solo BANNER/MODAL.
- media_bindings usa UNIQUE(scope,scope_id,slot) y onConflict exacto.

Después de reemplazar:
1. Hard refresh: Cmd + Shift + R.
2. Abrir admin.html.
3. Validar consola:
   window.APP?.__adminReady
4. Probar tabs: Eventos, Medios, Galería, Promos.

Importante:
Si las imágenes no se ven en el evento actual, verificar que media_bindings.scope_id apunte al ID real del evento actual.
