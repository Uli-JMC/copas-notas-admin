ECN Admin Connectivity Patch — 2026-05-16

Objetivo:
- Validar y corregir conexión entre Eventos, Fechas y Medios sin cambiar la BD ni la carpeta pública.
- Evitar que labels/campos se vacíen o queden desactualizados después de guardar en otro módulo.

Archivos incluidos:
- copas-notas-admin/js/admin.js
- copas-notas-admin/js/admin-media.js
- copas-notas-admin/js/admin-dates.js

Cambios clave:
1) admin.js
- Refresca relaciones del evento seleccionado al volver al tab Eventos.
- Escucha admin:dates:changed y admin:media:changed.
- Actualiza resumen de fechas, checklist y URLs de medios después de cambios externos.
- Corrige orden de limpieza/render para que no aparezcan resúmenes viejos o vacíos.
- Elimina listeners obsoletos de inputs de fecha/hora que ya no existen en el HTML.

2) admin-media.js
- Emite admin:media:changed al asignar, quitar asignación, subir, actualizar o eliminar assets.
- Cuando seleccionás un medio de Biblioteca/Asignados, rellena correctamente ID, folder, nombre y URL en el formulario.
- Mantiene preview y sincronización con Eventos.

3) admin-dates.js
- Emite admin:dates:changed al crear, actualizar o eliminar fechas.
- Permite que el editor de Eventos se actualice sin recargar la página.

Validación realizada:
- node --check OK en admin.js, admin-media.js y admin-dates.js.
- IDs usados por esos JS existen en admin.html o se crean dinámicamente.
- No hay IDs duplicados en admin.html.

Después de reemplazar:
- Hacer hard refresh: Cmd + Shift + R.
- Probar flujo:
  1. Abrir Eventos > seleccionar evento.
  2. Ir a Fechas > modificar fecha/cupos > guardar.
  3. Volver a Eventos: resumen/checklist debe actualizarse.
  4. Ir a Medios > asignar/quitar/actualizar imagen.
  5. Volver a Eventos: medios/checklist deben actualizarse.
