```javascript
/**
 * Theme Manager Module (Production-Grade)
 * =======================================
 *
 * A completely isolated theme management system with zero global leakage,
 * full DI support, and comprehensive lifecycle management.
 */

/**
 * Creates a new ThemeManager instance.
 * @param {Object} deps - Required dependencies
 * @param {Object} deps.dom - DOM abstraction layer
 * @param {Function} deps.dom.getDocumentAttribute
 * @param {Function} deps.dom.setDocumentAttribute
 * @param {Function} deps.dom.getElementById
 * @param {Function} deps.dom.createSVGElement
 * @param {Function} deps.dom.localStorageGet
 * @param {Function} deps.dom.localStorageSet
 * @param {Function} deps.dom.matchMedia
 * @param {Function} deps.dom.addMediaListener
 * @param {Function} deps.dom.addEventListener
 * @param {Function} deps.dom.createMutationObserver
 * @param {Object} deps.notify - Contextual notification system
 * @returns {Object} ThemeManager API
 */
export function createThemeManager(deps) {
  // --- Dependency Validation ---
  if (!deps?.dom) throw new Error('DOM abstraction layer required');
  if (!deps?.notify) throw new Error('Notification system required');

  const requiredDomMethods = [
    'getDocumentAttribute', 'setDocumentAttribute',
    'getElementById', 'localStorageGet',
    'localStorageSet', 'matchMedia'
  ];

  requiredDomMethods.forEach(method => {
    if (typeof deps.dom[method] !== 'function') {
      throw new Error(`DOM.${method} implementation required`);
    }
  });

  const { dom, notify } = deps;
  const themeNotifier = notify.withContext({
    module: 'ThemeManager',
    context: 'themeToggle'
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

  const setTheme = (theme, source = 'manual') => {
    const previousTheme = dom.getDocumentAttribute('data-theme');

    // Apply changes
    dom.setDocumentAttribute('data-theme', theme);
    dom.localStorageSet('theme', theme);
    updateThemeIcon(isDarkTheme(theme));

    // Log the change
    themeNotifier.info(`Theme changed to ${theme}`, {
      source,
      previousTheme,
      changedVia: source === 'system' ? 'OS preference' : 'user action'
    });

    return theme;
  };

  // --- Event Handlers ---
  const handleToggleClick = () => {
    const current = dom.getDocumentAttribute('data-theme');
    setTheme(
      isDarkTheme(current) ? THEMES.LIGHT : THEMES.DARK,
      'user-toggle'
    );
  };

  const handleSystemChange = (event) => {
    if (!getSavedTheme()) {
      setTheme(
        event.matches ? THEMES.DARK : THEMES.LIGHT,
        'system'
      );
    }
  };

  // --- Setup Functions ---
  const initializeToggleButton = () => {
    const button = dom.getElementById('darkModeToggle');
    if (!button) return;

    const cleanup = dom.addEventListener(button, 'click', handleToggleClick);
    cleanupCallbacks.push(cleanup);
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
    setTheme(themeToSet, savedTheme ? 'saved' : 'system');

    // Initial icon update
    updateThemeIcon(isDarkTheme(themeToSet));

    // Setup event listeners and observers
    initializeToggleButton();
    watchSystemPreferences();
    setupThemeObserver();
  };

  const teardown = () => {
    cleanupCallbacks.forEach(cleanup => {
      try {
        cleanup && cleanup();
      } catch (err) {
        themeNotifier.error('Cleanup callback failed', {
          source: 'teardown',
          extra: { error: err }
        });
      }
    });
    cleanupCallbacks = [];
    if (mutationObserver) {
      try {
        mutationObserver.disconnect();
      } catch (err) {
        themeNotifier.error('MutationObserver disconnect failed', {
          source: 'teardown',
          extra: { error: err }
        });
      }
      mutationObserver = null;
    }
  };

  return {
    initialize,
    teardown,
    setTheme,
    getSavedTheme,
    getSystemPreference,
    THEMES
  };
}

```