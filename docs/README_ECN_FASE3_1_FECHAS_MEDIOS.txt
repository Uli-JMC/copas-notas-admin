ECN Admin — UX Patch Fechas conectadas + Biblioteca Medios
Fecha: 2026-05-16

Archivos incluidos para reemplazar 1:1:
- copas-notas-admin/admin.html
- copas-notas-admin/css/admin.css
- copas-notas-admin/js/admin.js
- copas-notas-admin/js/admin-media.js

Cambios:
1) Eventos / Fecha, hora y lugar
- Se elimina el bloque confuso de fecha/hora manual que no estaba guardando en event_dates.
- Se reemplaza por un resumen conectado a event_dates.
- Muestra fecha principal, cupos disponibles/totales y duración si existe start_at/ends_at.
- Botón “Administrar fechas” abre el tab Fechas.
- Lugar, horario visible y duración siguen editables para mantener compatibilidad con el sitio público.
- Si el evento tiene fechas y el horario visible está vacío, el admin puede usar la fecha como referencia.

2) Medios / Biblioteca
- Cada medio en Biblioteca ahora tiene acciones: Usar, Actualizar y Eliminar.
- Actualizar abre un modal para reemplazar el archivo manteniendo el mismo media_assets.id.
- Al actualizar, las asignaciones existentes se mantienen porque se actualiza el mismo registro.
- Eliminar borra el registro media_assets y también intenta borrar el archivo del bucket media/video.
- Al eliminar media_assets, media_bindings se limpian por FK ON DELETE CASCADE.

Importante:
- No cambia la base de datos.
- No toca carpeta pública.
- No toca admin-auth.js.
- Hacer hard refresh después de reemplazar: Cmd + Shift + R.
