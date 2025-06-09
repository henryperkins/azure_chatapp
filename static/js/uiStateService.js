/**
 * uiStateService – front-end state façade (Phase-2.3)
 * --------------------------------------------------
 * A tiny in-memory store that provides one canonical place for view-level UI
 * flags that previously lived as "let visible = …" variables scattered across
 * components.  It intentionally keeps API surface minimal – only `setState`,
 * `getState`, `clearState`, and `cleanup` – because UI flags should not become
 * application logic.
 *
 * Guard-rails compliance:
 * • Factory function export, all dependencies via DI
 * • No side-effects at module scope
 * • Exposes cleanup() so it can be disposed deterministically
 */

export function createUIStateService({ logger } = {}) {
  if (!logger) {
    throw new Error('[uiStateService] logger dependency missing');
  }

  const MODULE = 'uiStateService';
  // Using Map to avoid accidental prototype pollution / key collisions.
  const state = new Map();

  /* ------------------------------------------------------------- */
  /* Internal helpers                                              */
  /* ------------------------------------------------------------- */

  function _composeKey(component, key) {
    if (!component) throw new Error(`[${MODULE}] component name is required`);
    if (!key) throw new Error(`[${MODULE}] key is required`);
    return `${component}.${key}`;
  }

  /* ------------------------------------------------------------- */
  /* Public API                                                    */
  /* ------------------------------------------------------------- */

  function setState(component, key, value) {
    const mapKey = _composeKey(component, key);
    state.set(mapKey, value);
    logger.debug(`[uiStateService] setState ${mapKey}=${value}`, { context: MODULE });
  }

  function getState(component, key) {
    return state.get(_composeKey(component, key));
  }

  function clearState(component) {
    for (const mapKey of Array.from(state.keys())) {
      if (mapKey.startsWith(`${component}.`)) state.delete(mapKey);
    }
    logger.debug(`[uiStateService] clearState for ${component}`, { context: MODULE });
  }

  function cleanup() {
    state.clear();
    logger.debug('[uiStateService] cleanup()', { context: MODULE });
  }

  return {
    setState,
    getState,
    clearState,
    cleanup
  };
}

export default createUIStateService;
