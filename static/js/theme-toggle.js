/**
 * @module themeToggle
 * @description Canonical DI-only factory for theme management (strict .clinerules compliance)
 * Exports a single createThemeManager({ ...deps }) factory. No top-level logic/side effects.
 *
 * @param {Object} deps - Dependency Injection options.
 * @param {Object} deps.dom - Required DOM abstraction layer.
 * @param {Object} deps.eventHandlers - Required event handler manager.
 * @param {Object} deps.logger - Required DI logger.
 * @returns {Object} ThemeManager API with lifecycle and theme utilities.
 */
const MODULE = "ThemeManager";

export function createThemeManager({ dom, eventHandlers, logger } = {}) {
  if (!dom) throw new Error(`[${MODULE}] DOM abstraction layer required`);
  if (!eventHandlers) throw new Error(`[${MODULE}] eventHandlers dependency required`);
  if (!logger) throw new Error(`[${MODULE}] logger dependency required`);

  const requiredDomMethods = [
    'getDocumentAttribute', 'setDocumentAttribute',
    'getElementById', 'localStorageGet',
    'localStorageSet', 'matchMedia'
  ];

  requiredDomMethods.forEach(method => {
    if (typeof dom[method] !== 'function') {
      throw new Error(`[${MODULE}] DOM.${method} implementation required`);
    }
  });

  // --- Constants ---
  const THEMES = Object.freeze({
    LIGHT: 'azure-light',
    DARK: 'dracula-enhanced'
  });

  const ICON_PATHS = Object.freeze({
    LIGHT: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
    DARK: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
  });

  // --- State Management ---
  let cleanupCallbacks = [];
  let mutationObserver;

  // --- Core Logic ---
  const isDarkTheme = (theme) => theme === THEMES.DARK;

  const updateThemeIcon = (isDarkMode) => {
    const iconEl = dom.getElementById('darkModeIcon');
    if (!iconEl) return;

    // Clear existing icon
    while (iconEl.firstChild) {
      iconEl.removeChild(iconEl.firstChild);
    }

    // Create new SVG path
    const path = dom.createSVGElement('path');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', isDarkMode ? ICON_PATHS.LIGHT : ICON_PATHS.DARK);

    iconEl.appendChild(path);
  };

  const getSystemPreference = () => {
    return dom.matchMedia('(prefers-color-scheme: dark)') ? THEMES.DARK : THEMES.LIGHT;
  };

  const getSavedTheme = () => {
    const saved = dom.localStorageGet('theme');
    return saved === THEMES.LIGHT || saved === THEMES.DARK ? saved : null;
  };

  const setTheme = (theme) => {
    // Store the old theme if needed
    const previousTheme = dom.getDocumentAttribute('data-theme');

    // Apply changes
    dom.setDocumentAttribute('data-theme', theme);
    dom.localStorageSet('theme', theme);
    updateThemeIcon(isDarkTheme(theme));

    // Return new theme
    return theme;
  };

  // --- Event Handlers ---
  const handleToggleClick = () => {
    const current = dom.getDocumentAttribute('data-theme');
    setTheme(isDarkTheme(current) ? THEMES.LIGHT : THEMES.DARK);
  };

  const handleSystemChange = (event) => {
    if (!getSavedTheme()) {
      setTheme(event.matches ? THEMES.DARK : THEMES.LIGHT);
    }
  };

  // --- Setup Functions ---
  const initializeToggleButton = () => {
    const button = dom.getElementById('darkModeToggle');
    if (!button) return;

    cleanupCallbacks.push(
      eventHandlers.trackListener(button, 'click', handleToggleClick, { context: MODULE })
    );
  };

  const watchSystemPreferences = () => {
    const mediaQuery = dom.matchMedia('(prefers-color-scheme: dark)');
    if (!mediaQuery) return;

    const cleanup = dom.addMediaListener(mediaQuery, handleSystemChange);
    cleanupCallbacks.push(cleanup);
  };

  const setupThemeObserver = () => {
    mutationObserver = dom.createMutationObserver(
      (mutations) => {
        mutations.forEach(mutation => {
          if (mutation.attributeName === 'data-theme') {
            const currentTheme = dom.getDocumentAttribute('data-theme');
            updateThemeIcon(isDarkTheme(currentTheme));
          }
        });
      },
      { attributes: true, attributeFilter: ['data-theme'] }
    );

    cleanupCallbacks.push(() => mutationObserver.disconnect());
  };

  // --- Public API ---
  const initialize = () => {
    // Set theme on load
    const savedTheme = getSavedTheme();
    const themeToSet = savedTheme || getSystemPreference();
    setTheme(themeToSet);

    // Initial icon update
    updateThemeIcon(isDarkTheme(themeToSet));

    // Setup event listeners and observers
    initializeToggleButton();
    watchSystemPreferences();
    setupThemeObserver();
  };

  const cleanup = () => {
    cleanupCallbacks.forEach(cleanup => {
      try {
        if (cleanup) cleanup();
      } catch (_err) {
        logger.error(`[${MODULE}] cleanup error`, _err, { context: MODULE + ':teardown' });
      }
    });
    cleanupCallbacks = [];

    if (mutationObserver) {
      try {
        mutationObserver.disconnect();
      } catch (_err) {
        logger.error(`[${MODULE}] cleanup error`, _err, { context: MODULE + ':teardown' });
      }
      mutationObserver = null;
    }

    if (eventHandlers && typeof eventHandlers.cleanupListeners === 'function') {
      eventHandlers.cleanupListeners({ context: MODULE });
    }
  };

  // backwards-compat
  const teardown = cleanup;

  return {
    initialize,
    cleanup,
    teardown,
    setTheme,
    getSavedTheme,
    getSystemPreference,
    THEMES
  };
}
