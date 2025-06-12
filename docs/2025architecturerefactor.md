📐  Canonical Guidelines & Refactor Rules
(the condensed “cheat-sheet” we follow for every JS module)

────────────────────────────────────────

    1. Module boundaries & size
       ────────────────────────────────────────
       • 1 factory = 1 file; no side-effects at import time.
       • Hard cap : 1000 LOC per module unless header declares
         // VENDOR-EXEMPT-SIZE.
       • Over 750 LOC → open follow-up ticket.
       • DOM code lives only in *Renderer.js files; business/service
         logic lives elsewhere.

────────────────────────────────────────
2.  Dependency Injection
────────────────────────────────────────
• All deps arrive as factory args ( { domAPI, logger, … } ).
• Never call DependencySystem.modules.get() after factory
  construction.
• Validate required deps (throw new Error early).
• Expose cleanup() that calls eventHandlers.cleanupListeners.

────────────────────────────────────────
3.  Layering
────────────────────────────────────────

┌────────────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│ Layer                  │ Allowed content                                                             │
├────────────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ Service (…Service.js)  │ Pure data / HTTP / state; no DOM                                            │
├────────────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ Controller (…Manager)  │ Orchestration; reads + writes services; no DOM                              │
├────────────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ Renderer (…Renderer)   │ DOM lookup / innerHTML / classList; no state                                │
├────────────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ Component (…Component) │ Thin façade that wires controller + renderer and subscribes to state/events │
└────────────────────────┴─────────────────────────────────────────────────────────────────────────────┘

────────────────────────────────────────
4.  State management
────────────────────────────────────────
• Single-source-of-truth services (e.g. KBStateService).
• Components read state via service, never keep their own copy.
• Services must emit <domain>Changed events through eventService.
• No module-scope let someFlag = … except immutable constants.

────────────────────────────────────────
5.  Event handling
────────────────────────────────────────
• Use DI-injected eventService (publish/subscribe) — no ad-hoc
  new EventTarget().
• DOM listeners registered only via eventHandlers.trackListener,
  always cleaned up in cleanup().

────────────────────────────────────────
6.  DOM access rules
────────────────────────────────────────
✔ Only in Renderer modules.
✔ Use DI-injected domAPI; no direct document.querySelector.
✔ Sanitize all innerHTML via DI sanitizer before insert.

────────────────────────────────────────
7.  Logging
────────────────────────────────────────
• Use DI logger.*(msg, meta); meta always contains { context }.
• Never console.* after bootstrap.

────────────────────────────────────────
8.  File locations
────────────────────────────────────────

┌───────────────────────────┬────────────────────────────────────┐
│ Folder                    │ What lives here                    │
├───────────────────────────┼────────────────────────────────────┤
│ static/services/          │ …Service.js  (data + state)        │
├───────────────────────────┼────────────────────────────────────┤
│ static/js/components/     │ UI factories if componentised      │
├───────────────────────────┼────────────────────────────────────┤
│ static/js/                │ Controllers, Components, Renderers │
├───────────────────────────┼────────────────────────────────────┤
│ static/js/utils/          │ Pure utilities (no DI needed)      │
├───────────────────────────┼────────────────────────────────────┤
│ static/js/initialization/ │ Boot sequence only                 │
└───────────────────────────┴────────────────────────────────────┘

────────────────────────────────────────
9.  Testing & CI guards
────────────────────────────────────────
• Jest unit tests for every service & renderer.
• patternsChecker.cjs rules:
  – no domAPI. outside Renderer.js
  – no module >1000 LOC (unless vendor-exempt)
  – no runtime DependencySystem.modules.get()
• Pre-commit runs ESLint + Jest.

────────────────────────────────────────
10.  Refactor workflow
────────────────────────────────────────

    1. Identify god-object (>750 LOC or mixed concerns).
    2. Extract pure data layer to …APIService.js.
    3. Extract state holder to …StateService.js.
    4. Move all DOM into …Renderer.js.
    5. Shrink original file to ≤300 LOC orchestrator.
    6. Add unit tests & pattern-checker rules.
    7. Update bootstrap registration and DI wiring.
    8. Run npm run lint + npx jest + patternsChecker.cjs.
    9. Open follow-up ticket if any module still >750 LOC.

Follow these ten sections and every refactor stays 100 % compliant with the 2025 architecture guard-rails.
