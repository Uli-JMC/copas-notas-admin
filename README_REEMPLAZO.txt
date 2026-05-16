ECN Admin replacements v2026-02-26

Archivos incluidos para reemplazar 1:1:
- admin.html
- js/admin-auth.js
- js/admin.js
- js/admin-registrations.js
- js/admin-media.js
- js/admin-gallery.js
- js/admin-promos.js

Cambios clave:
1. Opción B consolidada:
   - admin-auth.js controla ingreso, permisos, redirecciones y logout.
   - admin.js espera admin:ready y muestra #appPanel.

2. Eventos:
   - admin.js emite admin:tab en window y document.
   - updateEvent reintenta sin slug/badge/active si tu tabla events no tiene esas columnas.

3. Inscripciones:
   - Render alineado al HTML: Evento, Fecha, Nombre, Email, Teléfono, Marketing, Creado.

4. Media:
   - Se conserva tu admin-media.js actual.

5. Galería:
   - Se elimina ID duplicado.
   - admin.html usa #ecnGalleryId para galería.
   - admin-gallery.js usa #ecnGalleryId.
   - Carga después de admin:ready y al abrir tab Galería.

6. Promos:
   - Carga después de admin:ready y al abrir tab Promos.

Verificación:
- Todos los JS pasan node --check.
- admin.html queda sin IDs duplicados.
