```css
/* =============================================================================
   tailwind.css (Aggregator, Tailwind v4 + DaisyUI 5)
   =============================================================================
   - Imports Tailwind v4 core (all layers)
   - Loads DaisyUI with both azure-light (default) and dracula-enhanced (dark) themes
   - Defines global fadeZoomIn animation and utility
   - Aggregates all project custom/partial CSS
============================================================================= */

/* 1. Import Tailwind core (v4 unified import layer) */
@import "tailwindcss";

/* 2. DaisyUI plugin and theme registration (CSS-first, Tailwind v4+) */
@plugin "daisyui" {
  themes: azure-light --default, dracula-enhanced --prefersdark;
}

/* 3. Global keyframes for fadeZoomIn (for .file-preview-item and .animate-fadeZoomIn) */
@keyframes fadeZoomIn {
  0%   { opacity: 0; transform: scale(0.95);}
  100% { opacity: 1; transform: scale(1);}
}

/* 4. Tailwind v4+: Global utility for fadeZoomIn animation (supports responsive, etc.) */
@utility animate-fadeZoomIn {
  animation: fadeZoomIn 0.3s ease-out forwards;
}

/* Move notification-accordion.css higher in import order */
@import "./enhanced-components.css";
@import "./file-upload-enhanced.css";
@import "./legacy-dracula-theme.css";
@import "./project-details-enhancements.css";
@import "./project-list-enhancements.css";

/* =============================================================================
   End of Aggregate Stylesheet
============================================================================= */

```