ECN Admin Media Folder Picker + Biblioteca de Medios Existentes

Archivos incluidos:
- copas-notas-admin/js/admin-media.js
- copas-notas-admin/css/admin.css

Qué agrega:
1. El campo Folder ahora tiene selector de folders existentes.
   - Los folders se leen desde public.media_assets.folder.
   - Se filtran por bucket elegido: media o video.
   - También podés escribir un folder nuevo manualmente.
   - Al subir un archivo a un folder nuevo, luego aparece en la lista de folders.

2. Agrega búsqueda de medios ya subidos.
   - Permite buscar por nombre, folder, URL o mime.
   - Permite usar “Ver todos” para elegir un archivo ya subido y reasignarlo.

3. Mantiene la funcionalidad actual:
   - Subir archivo.
   - Pegar URL externa.
   - Seleccionar medio.
   - Preview.
   - Asignar a slot.
   - Ver asignados.
   - Quitar asignación sin borrar archivo.

Notas:
- No cambia BD.
- No toca carpeta pública.
- No cambia IDs existentes.
- No modifica admin.html.
- No hace upsert a la view; sigue usando media_bindings.

Después de reemplazar, hacer hard refresh: Cmd + Shift + R.
