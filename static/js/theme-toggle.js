/**
 * Theme Toggle for DaisyUI 5 with Tailwind v4, supporting custom themes
 * (azure-light for light mode, dracula-enhanced for dark mode).
 *
 * This script handles dark mode toggle functionality and keeps
 * everything in sync with DaisyUI/Tailwind's required theme names.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Theme names used in DaisyUI config
  const LIGHT_THEME = 'azure-light';
  const DARK_THEME = 'dracula-enhanced';

  const darkModeToggle = document.getElementById('darkModeToggle');
  const darkModeIcon = document.getElementById('darkModeIcon');

  // Set icon based on current theme
  function updateThemeUI(isDark) {
    if (!darkModeIcon) return;
    // Remove all children (old paths)
    while (darkModeIcon.firstChild) {
      darkModeIcon.removeChild(darkModeIcon.firstChild);
    }
    // Create new path
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-width", "2");
    if (isDark) {
      // Sun (light) icon for dark mode
      path.setAttribute("d", "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z");
    } else {
      // Moon (dark) icon for light mode
      path.setAttribute("d", "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z");
    }
    darkModeIcon.appendChild(path);
  }

  // Which DaisyUI theme name is considered "dark"?
  function isCurrentThemeDark(theme) {
    return theme === DARK_THEME;
  }

  // Retrieve current theme from storage or OS preference (returns DaisyUI theme name)
  function getCurrentTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === LIGHT_THEME || savedTheme === DARK_THEME) {
      return savedTheme;
    }
    // Fall back to system
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK_THEME : LIGHT_THEME;
  }

  // Set theme and store
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeUI(isCurrentThemeDark(theme));
  }

  // On page load: set theme and update icon
  const currentTheme = getCurrentTheme();
  setTheme(currentTheme);

  // Toggle theme on button click between DaisyUI theme names
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const themeNow = document.documentElement.getAttribute('data-theme');
      const newTheme = (themeNow === DARK_THEME) ? LIGHT_THEME : DARK_THEME;
      setTheme(newTheme);
      updateThemeUI(isCurrentThemeDark(newTheme)); // Ensure icon updates immediately
    });
  }

  // Listen for system changes (if no manual selection is set)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) {
      const newTheme = e.matches ? DARK_THEME : LIGHT_THEME;
      setTheme(newTheme);
    }
  });

  // Watch for changes to data-theme (in case other scripts change it)
  const observer = new MutationObserver(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    updateThemeUI(isCurrentThemeDark(theme));
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Initial icon update (in case theme was set before DOMContentLoaded)
  updateThemeUI(isCurrentThemeDark(document.documentElement.getAttribute('data-theme')));
});
