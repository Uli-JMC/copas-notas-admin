ECN Admin Eventos UX/UI v1.1 — Diseño aplicado

Cambios aplicados:
- Rediseño visual del tab Eventos según guía PDF.
- Layout premium off-white con tarjetas blancas, bordes suaves, acento morado y jerarquía mejorada.
- Editor agrupado en secciones plegables: Información general, Fecha y lugar, Venta, Descripción, Medios y Publicación.
- Medios queda como sección desplegable/collapsible por defecto, manteniendo inputs readonly y botones Gestionar en Medios.
- Lista de eventos rediseñada con icono, título, tipo, mes, chip Publicado/Borrador y chevron.
- Footer sticky con Eliminar y Guardar.
- Se agregaron campos UX auxiliares: Fecha del evento, Hora inicio y Hora final.
  Estos NO cambian la BD; sincronizan mes, horario visible y duración para mantener compatibilidad.
- Se conservan IDs existentes conectados a Supabase/JS.
- No se toca el flujo de media_bindings: los medios siguen gestionándose desde la pestaña Medios.

Archivos modificados:
- admin.html
- css/admin.css
- js/admin.js

Validaciones:
- Sin IDs duplicados en admin.html.
- JS validado con node --check.
- Se conservan mediaForm, regsTbody, eventForm, evType, evMonth, evBannerDesktopUrl, evBannerMobileUrl.

Instalación:
1. Reemplazar el proyecto o copiar estos archivos sobre tu proyecto actual.
2. Hacer hard refresh en navegador: Cmd + Shift + R.
3. Validar en consola: window.APP?.__adminReady debe devolver true.
4. Probar: Eventos > editar > abrir/cerrar Medios > Gestionar en Medios > Guardar.
