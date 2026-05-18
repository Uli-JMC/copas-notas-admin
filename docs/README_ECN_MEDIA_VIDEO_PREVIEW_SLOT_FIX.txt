ECN — Media video preview + slot compatibility fix

Reemplazar:
- copas-notas-admin/js/admin-media.js
- copas-notas-admin/css/admin.css

Qué corrige:
- El Preview de Medios ahora muestra videos con <video controls>, no intenta renderizarlos como imagen.
- Si seleccionás un video, el selector de slot deja disponible únicamente Home Slider · Video (slide_video).
- Si seleccionás una imagen, no permite usar el slot slide_video.
- Al intentar asignar un video a mobile_event/desktop_event/slide_img/event_more, muestra advertencia y bloquea el guardado.
- Los asignados incompatibles se marcan con advertencia para corregirlos.

Importante:
- Si ya tenés un video asignado por error a slide_img, el sitio público puede verse gris/en blanco porque ese slot espera imagen.
- Usá Medios > Ver asignados > Quitar en el slot incorrecto y luego asigná el video a Home Slider · Video.
- También se incluye un SQL opcional para mover videos asignados por error a slide_video.

Después de reemplazar: Cmd + Shift + R.
