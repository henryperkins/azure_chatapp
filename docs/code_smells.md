# Code Smells Detected

## 1. God / Mega Classes
- ProjectManager (~900 líneas)
- ChatManager (~1 600 líneas, mezcla red-API/DOM/UI)
- ProjectDashboard, ProjectDetailsComponent, Sidebar, EventHandler  
  → Rompen el principio de responsabilidad única; difícil de testear y mantener.

## 2. Funciones excesivamente largas
- initializeUIComponents (≈340 líneas)
- ChatManager.initialize (≈340 líneas)
- ProjectDashboard.showProjectDetails, _setView, etc.  
  → Refactorizar en helpers más pequeños.

## 3. Constructores y fábricas con listas de parámetros muy extensas
Ej.: `createProjectDetailsComponent`, `createSidebar`, `createChatManager`  
  → Usar objetos de configuración o DI contenedores para reducir longitud.

## 4. Duplicación de lógica/UI
- `_showMessage`, `_createThinkingBlock`, indicadores de “thinking/loading” aparecen en ChatManager y attachChatUI.
- Código repetido para toggle de pestañas (ProjectDetails vs Sidebar).

## 5. Comentario / código muerto
- Numerosos `// console.error … // Removed`
- Bloques enteros comentados (debug, old way vs new way).  
  → Eliminar o mover a utilidades de logging.

## 6. Dependencia a `globalThis.document` y `window` en módulos que declaran DI estricta  
  → Viola las propias guardrails (ej. ProjectManager, ProjectDetailsComponent).

## 7. Manejo silencioso de errores
`catch { /* silent */ }` o `// Error handled silently`  
  → Oculta fallos y complica debugging.

## 8. Estados duplicados y flags ad-hoc
- currentProject almacenado en varios lugares (ProjectManager, app, Sidebar).
- Flags como `_uiReadyFlag`, `_dataReadyFlag`, `_lastReadyEmittedId` proliferan.

## 9. Uso excesivo de eventos personalizados sin tipado ni documentación
Dificulta trazabilidad (`projectDetailsReady`, `sidebarTabChanged`, etc.).

## 10. Nombres y convenciones inconsistentes
- normaliseUrl vs normalizeUrl (dos aliases)
- ProjectDetail**s**Component vs projectDetails (plural/singular)  
  → Unificar.

## 11. Abuso de `try/catch` “full blanket”
Muchas capturas silenciosas con comentarios “Removed” → ocultan bugs.

## 12. Mezcla de responsabilidades de infraestructura y UI
Ej.: EventHandler maneja colapsibles, formularios, modales y navegación.

---

Recomendaciones generales:
1. Extraer módulos más pequeños (API service, UI renderer, state manager).
2. Aplicar Single Responsibility y separar DOM/UI de lógica de negocio.
3. Eliminar código muerto y `catch` silenciosos; usar logger centralizado.
4. Documentar y tipar eventos personalizados.
5. Añadir tests unitarios para helpers aislados.
