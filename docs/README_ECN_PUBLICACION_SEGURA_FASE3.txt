ECN Admin — Fase 3: Publicación segura
Fecha: 2026-05-16

Archivos incluidos:
- copas-notas-admin/admin.html
- copas-notas-admin/css/admin.css
- copas-notas-admin/js/admin.js

Qué agrega:
1. Checklist de publicación en el editor de Eventos.
2. Validación antes de publicar:
   - Título definido
   - Tipo y mes definidos
   - Descripción agregada
   - Lugar definido
   - Horario o fecha conectada
   - Fecha/cupos conectados desde event_dates
   - Banner desktop asignado
   - Banner mobile asignado
3. Si el estado está en Publicado y faltan puntos críticos, bloquea el guardado como publicado.
4. Si el evento está en Borrador, permite guardar aunque falten datos.
5. Estado visual de guardado:
   - Sin cambios
   - Cambios sin guardar
   - Guardando…
   - Sincronizado
   - Error al guardar
6. Botón “Validar ahora”.

No cambia:
- Base de datos
- Supabase Client
- admin-auth.js
- admin-media.js
- admin-dates.js
- carpeta pública

Notas importantes:
- Esta fase asume que Fase 1 y Fase 2 ya fueron aplicadas.
- El checklist consulta event_dates para saber si el evento tiene fecha/cupos.
- Los medios se validan desde v_media_bindings_latest usando desktop_event y mobile_event.
