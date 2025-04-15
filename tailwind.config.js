// Tailwind CSS Configuration
// Adding daisyUI plugin for the base-200 and related classes.

import daisyui from 'daisyui';

export default {
  content: [
    "./static/html/*.html",
    "./static/js/*.js"
  ],
  theme: {
    extend: {
      borderRadius: {
        'xs': '0.125rem',  // Previously was 'sm'
        'sm': '0.25rem',   // Previously was DEFAULT
        'md': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        'full': '9999px'
      }
    }
  },
  plugins: [
    daisyui
  ],
  daisyui: {
    themes: ["light", "dark"]
  }
};
