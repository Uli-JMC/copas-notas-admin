ECN — Admin Medios UX/UI Fase 2
Fecha: 2026-05-16

Archivos modificados:
- copas-notas-admin/admin.html
- copas-notas-admin/css/admin.css
- copas-notas-admin/js/admin-media.js

Objetivo:
Mejorar la experiencia del módulo Medios sin cambiar funcionalidad ni base de datos.

Cambios UX/UI:
1. Medios ahora usa un flujo por pasos:
   - 1. Subir
   - 2. Biblioteca
   - 3. Asignar

2. Se separan tareas para reducir confusión:
   - Subir nuevo archivo
   - Reutilizar medios ya subidos
   - Previsualizar y asignar a slots

3. La biblioteca mantiene:
   - Selector de bucket
   - Folder manual
   - Selector/lista de folders existentes
   - Actualizar folders
   - Buscador de medios subidos
   - Ver todos

4. Asignación mejorada:
   - Preview antes de asignar
   - Selector de evento/menú
   - Selector “Dónde va” con nombres humanos
   - Ver asignados
   - Click en asignado para preview
   - Copiar URL
   - Quitar asignación sin borrar archivo

5. Funcionalidad mantenida:
   - No se cambia BD
   - No se cambia carpeta pública
   - No se cambian IDs principales
   - onConflict sigue siendo: scope,scope_id,slot
   - media_assets y media_bindings se mantienen igual

Validación:
- admin-media.js pasa node --check
- admin.html sin IDs duplicados

Después de reemplazar:
- Hacer Cmd + Shift + R
- Entrar a Admin > Medios
- Probar: Biblioteca > elegir asset > Asignar > Ver asignados
