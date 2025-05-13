```css
/* =============================================================================
   legacy-dracula-theme.css
   =============================================================================
   🚨 Legacy file: Only for necessary sidebar/focus/scrollbar overrides! 🚨

   ▸ All DaisyUI Dracula/dark theme CSS variable definitions are now exclusively managed in:
       static/css/enhanced-components.css
     (including --color-primary, --color-base-200, etc.)

   ▸ Do NOT define or update theme variables here—changes to theme colors must ONLY be made in enhanced-components.css.
   ▸ If in doubt, read the top of enhanced-components.css for instructions.

   ▸ This file should only contain minimal legacy overrides required for sidebar polish or focus/scrollbar appearance.
   ▸ Remove any code from this file that does not relate to sidebar/focus/scrollbar—future dark mode/Dracula styling must
     be layered in enhanced-components.css.

   ----------------------------------------------------------------------------
*/

/* Sidebar pinned state highlight */
.sidebar.sidebar-pinned {
  box-shadow:
    0 0 0 2px var(--color-primary, #ff55a8),
    0 0 14px 4px rgba(255, 85, 168, 0.25);
  border-radius: 0 1rem 1rem 0;
}

/* Hide scrollbar utility for tab rows & other overflow-x UI */
.no-scrollbar {
  -ms-overflow-style: none; /* IE/Edge fallback */
  scrollbar-width: none;    /* Firefox */
}
.no-scrollbar::-webkit-scrollbar {
  display: none;            /* Chrome/Safari */
}

/* Stronger focus ring for sidebar actions/tabs */
.sidebar-btn:focus-visible,
.tab:focus-visible,
.btn:focus-visible,
#pinSidebarBtn:focus-visible,
#closeSidebarBtn:focus-visible {
  outline: 2px solid var(--color-primary, #ff55a8) !important;
  outline-offset: 2px;
  box-shadow: 0 0 0 3px rgba(255, 85, 168, 0.32) !important;
}

/* Themed scrollbar for sidebar */
.sidebar ::-webkit-scrollbar {
  width: 8px;
  background: var(--color-base-200, #23243a);
}
.sidebar ::-webkit-scrollbar-thumb {
  background: linear-gradient(to bottom, var(--color-primary, #ff55a8), #a086ba 80%);
  border-radius: 3px;
  border: 1px solid var(--color-base-200, #23243a);
}
.sidebar ::-webkit-scrollbar-thumb:hover {
  background: var(--color-accent, #f1fa8c);
}
.sidebar {
  scrollbar-width: thin;
  scrollbar-color: var(--color-primary, #ff55a8) var(--color-base-200, #23243a);
}

```